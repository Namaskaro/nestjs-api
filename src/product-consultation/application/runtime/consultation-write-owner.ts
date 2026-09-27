import { randomUUID } from 'node:crypto';

import { isDeepStrictEqual } from 'node:util';

import type { ProductSearchPort } from '../search/product-search.port';

import { CATEGORY_PROFILES } from '../../core/profiles';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
  failSearchExecution,
} from '../../core/results/consultation-results';

import {
  ConsultationResultsStateSchema,
  type ConsultationResultsState,
} from '../../core/results/consultation-results.schema';

import type { ResolvedProductSelection } from '../../core/results/consultation-results';

import type { SearchSpec } from '../../core/search/search-spec.schema';

import { prepareConsultationTurn } from '../../core/turn/consultation-turn-boundary';

import {
  ConsultationTurnProposalSchema,
  type ConsultationTurnProposal,
} from '../../core/turn/consultation-turn-proposal.schema';

import {
  appendProcessedRequestId,
  ConsultationApplicationRecordSchema,
  ConsultationRequestIdSchema,
  createConsultationApplicationRecord,
  type ConsultationApplicationRecord,
} from './consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from './consultation-application-store.port';

export type ConsultationWriteOwnerIdFactories = {
  createMemoryId?: () => string;

  createExecutionId?: () => string;

  createResultId?: () => string;
};

export type ExecuteConsultationTurnInput = {
  conversationId: string;

  expectedRevision: number;

  requestId: string;

  proposal: unknown;

  expectedResultId: string | null;
};

type ResolvedTurnSelections = {
  resolvedSelection: ResolvedProductSelection | null;

  resolvedFeedbackSelection: ResolvedProductSelection | null;
};

export type ExecuteConsultationTurnResult = ResolvedTurnSelections &
  (
    | {
        status: 'accepted';

        record: ConsultationApplicationRecord;
      }
    | {
        status: 'duplicate';

        record: ConsultationApplicationRecord;
      }
    | {
        status: 'search_succeeded';

        record: ConsultationApplicationRecord;
      }
    | {
        status: 'search_failed';

        record: ConsultationApplicationRecord;

        error: unknown;
      }
    | {
        status: 'superseded';

        record: ConsultationApplicationRecord;
      }
  );

type FinalizeSearchResult =
  | {
      status: 'committed';

      record: ConsultationApplicationRecord;
    }
  | {
      status: 'superseded';

      record: ConsultationApplicationRecord;
    };

const FINALIZE_CAS_ATTEMPTS = 3;

function nextRecord(
  current: ConsultationApplicationRecord,

  patch: Omit<ConsultationApplicationRecord, 'version' | 'revision'>,
): ConsultationApplicationRecord {
  return ConsultationApplicationRecordSchema.parse({
    version: 1,

    revision: current.revision + 1,

    ...patch,
  });
}

/**
 * Profile определяется:
 *
 * 1. новым complete SearchSpec,
 *    если proposal его несёт;
 *
 * 2. иначе current task SearchSpec.
 *
 * Это позволяет CLARIFY
 * сохранить условия новой задачи
 * до первого поиска.
 */
function resolveProfile(
  current: ConsultationApplicationRecord,

  proposal: ConsultationTurnProposal,
) {
  const category =
    proposal.search?.category ??
    (proposal.taskTransition === 'start_new'
      ? null
      : current.state?.search?.category ?? null);

  if (category === null) {
    return null;
  }

  return CATEGORY_PROFILES.find((profile) => profile.id === category) ?? null;
}

function expectedResultIdForProposal(
  proposal: ConsultationTurnProposal,

  expectedResultId: string | null,
): string | null {
  if (proposal.taskTransition === 'start_new') {
    return null;
  }

  return expectedResultId;
}

function assertExpectedRevision(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      'ConsultationWriteOwner: expectedRevision must be a non-negative integer.',
    );
  }
}

/**
 * SearchSpec изменился БЕЗ
 * нового SearchExecution.
 *
 * Значит старая выдача
 * больше не соответствует
 * authoritative SearchSpec.
 *
 * active → null
 *
 * lastConfirmed сохраняем
 * как последний исторически
 * подтверждённый snapshot.
 *
 * pending/lastFailure относятся
 * к предыдущему search lifecycle
 * и больше не current.
 */
function detachResultsFromChangedSearch(
  currentRaw: ConsultationResultsState,
): ConsultationResultsState {
  const current = ConsultationResultsStateSchema.parse(currentRaw);

  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    pendingSearch: null,

    active: null,

    lastConfirmed: current.lastConfirmed,
  });
}

export class ConsultationWriteOwner {
  private readonly createMemoryId: () => string;

  private readonly createExecutionId: () => string;

  private readonly createResultId: () => string;

  constructor(
    private readonly store: ConsultationApplicationStore,

    private readonly productSearch: ProductSearchPort,

    ids: ConsultationWriteOwnerIdFactories = {},
  ) {
    this.createMemoryId = ids.createMemoryId ?? randomUUID;

    this.createExecutionId = ids.createExecutionId ?? randomUUID;

    this.createResultId = ids.createResultId ?? randomUUID;
  }

  public async execute(
    input: ExecuteConsultationTurnInput,
  ): Promise<ExecuteConsultationTurnResult> {
    const conversationId = input.conversationId.trim();

    if (!conversationId) {
      throw new Error('ConsultationWriteOwner: conversationId is required.');
    }

    assertExpectedRevision(input.expectedRevision);

    const requestId = ConsultationRequestIdSchema.parse(input.requestId);

    const loaded =
      (await this.store.load(conversationId)) ??
      createConsultationApplicationRecord();

    const current = ConsultationApplicationRecordSchema.parse(loaded);

    if (current.processedRequestIds.includes(requestId)) {
      return {
        status: 'duplicate',

        record: current,

        resolvedSelection: null,

        resolvedFeedbackSelection: null,
      };
    }

    if (current.revision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        conversationId,

        input.expectedRevision,

        current.revision,
      );
    }

    const proposal = ConsultationTurnProposalSchema.parse(input.proposal);

    const baseResults =
      proposal.taskTransition === 'start_new'
        ? createConsultationResultsState()
        : current.results;

    const prepared = prepareConsultationTurn({
      currentState: current.state,

      currentResults: baseResults,

      proposal,

      categoryProfile: resolveProfile(
        current,

        proposal,
      ),

      expectedResultId: expectedResultIdForProposal(
        proposal,

        input.expectedResultId,
      ),

      createMemoryId: this.createMemoryId,
    });

    let results = baseResults;

    let executionId: string | null = null;

    let search: SearchSpec | null = null;

    /**
     * PRE-SEARCH CLARIFY.
     *
     * SearchSpec не исполняется,
     * но он всё равно обязан быть
     * реально executable текущим
     * Store adapter.
     *
     * SearchSpec = executable
     * hard constraints only.
     */
    if (proposal.action === 'CLARIFY' && proposal.search !== null) {
      const persistedSearch = prepared.turn.state.search;

      if (persistedSearch === null) {
        throw new Error(
          'ConsultationWriteOwner: CLARIFY persisted SearchSpec is missing.',
        );
      }

      this.productSearch.validate(persistedSearch);

      /**
       * Если SearchSpec действительно
       * изменился, старая active выдача
       * больше не current.
       *
       * start_new уже получил
       * свежий empty ResultsState.
       */
      const searchChanged = !isDeepStrictEqual(
        current.state?.search ?? null,

        persistedSearch,
      );

      if (proposal.taskTransition !== 'start_new' && searchChanged) {
        results = detachResultsFromChangedSearch(results);
      }
    }

    if (prepared.turn.searchRequired) {
      search = prepared.turn.state.search;

      if (search === null) {
        throw new Error(
          'ConsultationWriteOwner: searchRequired without SearchSpec.',
        );
      }

      this.productSearch.validate(search);

      const started = beginSearchExecution(
        results,

        search,

        this.createExecutionId,
      );

      results = started.state;

      executionId = started.executionId;
    }

    const generation =
      proposal.taskTransition === 'start_new'
        ? current.generation + 1
        : current.generation;

    const preparedRecord = nextRecord(
      current,

      {
        generation,

        state: prepared.turn.state,

        results,

        processedRequestIds: appendProcessedRequestId(
          current.processedRequestIds,

          requestId,
        ),
      },
    );

    try {
      await this.store.saveIfRevision({
        conversationId,

        expectedRevision: current.revision,

        record: preparedRecord,
      });
    } catch (error) {
      if (error instanceof ConsultationWriteConflictError) {
        const fresh = await this.store.load(conversationId);

        if (fresh?.processedRequestIds.includes(requestId)) {
          return {
            status: 'duplicate',

            record: ConsultationApplicationRecordSchema.parse(fresh),

            resolvedSelection: null,

            resolvedFeedbackSelection: null,
          };
        }
      }

      throw error;
    }

    if (
      !prepared.turn.searchRequired ||
      search === null ||
      executionId === null
    ) {
      return {
        status: 'accepted',

        record: preparedRecord,

        resolvedSelection: prepared.resolvedSelection,

        resolvedFeedbackSelection: prepared.resolvedFeedbackSelection,
      };
    }

    /**
     * S2:
     *
     * SearchPort failure отделён
     * от persistence/finalization.
     */
    let products: Awaited<ReturnType<ProductSearchPort['search']>>;

    try {
      products = await this.productSearch.search(search);
    } catch (error) {
      const finalized = await this.finalizeFailedSearch({
        conversationId,

        generation,

        executionId,
      });

      if (finalized.status === 'superseded') {
        return {
          status: 'superseded',

          record: finalized.record,

          resolvedSelection: prepared.resolvedSelection,

          resolvedFeedbackSelection: prepared.resolvedFeedbackSelection,
        };
      }

      return {
        status: 'search_failed',

        record: finalized.record,

        error,

        resolvedSelection: prepared.resolvedSelection,

        resolvedFeedbackSelection: prepared.resolvedFeedbackSelection,
      };
    }

    /**
     * SearchPort уже успешно
     * завершился.
     *
     * Ошибка здесь —
     * persistence/finalization error,
     * не search_failed.
     */
    const finalized = await this.finalizeSuccessfulSearch({
      conversationId,

      generation,

      executionId,

      products,
    });

    if (finalized.status === 'superseded') {
      return {
        status: 'superseded',

        record: finalized.record,

        resolvedSelection: prepared.resolvedSelection,

        resolvedFeedbackSelection: prepared.resolvedFeedbackSelection,
      };
    }

    return {
      status: 'search_succeeded',

      record: finalized.record,

      resolvedSelection: prepared.resolvedSelection,

      resolvedFeedbackSelection: prepared.resolvedFeedbackSelection,
    };
  }

  private async finalizeSuccessfulSearch(input: {
    conversationId: string;

    generation: number;

    executionId: string;

    products: Awaited<ReturnType<ProductSearchPort['search']>>;
  }): Promise<FinalizeSearchResult> {
    return this.finalizeSearch({
      conversationId: input.conversationId,

      generation: input.generation,

      executionId: input.executionId,

      commit: (current) =>
        commitSearchExecution(
          current.results,

          input.executionId,

          input.products,

          this.createResultId,
        ),
    });
  }

  private async finalizeFailedSearch(input: {
    conversationId: string;

    generation: number;

    executionId: string;
  }): Promise<FinalizeSearchResult> {
    return this.finalizeSearch({
      conversationId: input.conversationId,

      generation: input.generation,

      executionId: input.executionId,

      commit: (current) =>
        failSearchExecution(
          current.results,

          input.executionId,
        ),
    });
  }

  private async finalizeSearch(input: {
    conversationId: string;

    generation: number;

    executionId: string;

    commit: (
      current: ConsultationApplicationRecord,
    ) => ConsultationApplicationRecord['results'];
  }): Promise<FinalizeSearchResult> {
    for (let attempt = 0; attempt < FINALIZE_CAS_ATTEMPTS; attempt += 1) {
      const loaded = await this.store.load(input.conversationId);

      if (loaded === null) {
        throw new Error(
          'ConsultationWriteOwner: persisted record disappeared during search.',
        );
      }

      const current = ConsultationApplicationRecordSchema.parse(loaded);

      if (current.generation !== input.generation) {
        return {
          status: 'superseded',

          record: current,
        };
      }

      if (current.results.pendingSearch?.executionId !== input.executionId) {
        return {
          status: 'superseded',

          record: current,
        };
      }

      const results = input.commit(current);

      const next = nextRecord(
        current,

        {
          generation: current.generation,

          state: current.state,

          results,

          processedRequestIds: current.processedRequestIds,
        },
      );

      try {
        await this.store.saveIfRevision({
          conversationId: input.conversationId,

          expectedRevision: current.revision,

          record: next,
        });

        return {
          status: 'committed',

          record: next,
        };
      } catch (error) {
        if (error instanceof ConsultationWriteConflictError) {
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      'ConsultationWriteOwner: search finalization exceeded CAS retry limit.',
    );
  }
}
