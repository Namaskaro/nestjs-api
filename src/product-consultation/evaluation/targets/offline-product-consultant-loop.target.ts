import { randomUUID } from 'node:crypto';

import { CurrentStoreSearchSpecAdapter } from '../../adapters/current-store/current-store-search-spec.adapter';

import {
  ProductConsultantLoop,
  type ProductConsultantLoopArtifact,
  type ProductConsultantLoopOutcome,
} from '../../application/consultant/product-consultant-loop';

import type {
  ProductConsultantModelInput,
  ProductConsultantModelPort,
} from '../../application/consultant/product-consultant-model.port';

import type { ProductDetailsPort } from '../../application/catalog/product-details.port';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../../application/runtime/consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from '../../application/runtime/consultation-application-store.port';

import { ConsultationWriteOwner } from '../../application/runtime/consultation-write-owner';

import type { ProductSearchPort } from '../../application/search/product-search.port';

import {
  EvaluationJsonValueSchema,
  type EvaluationJsonValue,
} from '../contracts/evaluation-scenario';

import type { EvaluationArtifact } from '../contracts/evaluation-observation';

import {
  FrozenCurrentProductCatalog,
  type CurrentProductConsultationFixture,
} from '../fixtures/current-product-consultation.fixture';

import { createEvaluationCapabilityProxy } from '../recording/evaluation-capability-proxy';

import type {
  EvaluationLlmCallSink,
  EvaluationTargetAdapter,
  EvaluationTargetRunInput,
  EvaluationTargetRunResult,
} from './evaluation-target';

type TurnDecisionRegistry = Readonly<Record<string, readonly unknown[]>>;

export const OFFLINE_PRODUCT_CONSULTANT_WAIT_FOR_ABORT = Object.freeze({
  __offlineControl: 'wait_for_abort',
} as const);

export type OfflineProductConsultantLoopTargetOptions = {
  modelTimeoutMs?: number;

  /**
   * Нужен для offline cancellation
   * regression.
   *
   * Production cancellation приходит
   * в ProductConsultantLoop.run().
   */
  signal?: AbortSignal;
};

class SingleRecordConsultationStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord | null;

  constructor(initial: ConsultationApplicationRecord | null) {
    this.record =
      initial === null
        ? null
        : ConsultationApplicationRecordSchema.parse(structuredClone(initial));
  }

  public async load(
    _conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    return this.record === null
      ? null
      : ConsultationApplicationRecordSchema.parse(structuredClone(this.record));
  }

  public async saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void> {
    const actualRevision = this.record?.revision ?? 0;

    if (actualRevision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,

        input.expectedRevision,

        this.record?.revision ?? null,
      );
    }

    this.record = ConsultationApplicationRecordSchema.parse(
      structuredClone(input.record),
    );
  }
}

function toEvaluationJson(value: unknown): EvaluationJsonValue {
  return EvaluationJsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function isWaitForAbortControl(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    (
      value as {
        __offlineControl?: unknown;
      }
    ).__offlineControl === 'wait_for_abort'
  );
}

class OfflineProductConsultantModel implements ProductConsultantModelPort {
  private callIndex = 0;

  constructor(
    private readonly decisions: readonly unknown[],

    private readonly sink: EvaluationLlmCallSink | null,
  ) {}

  public async decide(input: ProductConsultantModelInput): Promise<unknown> {
    const startedAt = Date.now();

    const callId = randomUUID();

    const decision = this.decisions[this.callIndex];

    this.callIndex += 1;

    if (decision === undefined) {
      const message = 'OfflineProductConsultantModel: no queued decision.';

      this.recordCall({
        callId,

        startedAt,

        error: message,
      });

      throw new Error(message);
    }

    /**
     * Только evaluation control:
     *
     * модель висит,
     * пока loop timeout/cancellation
     * не оборвёт signal.
     */
    if (isWaitForAbortControl(decision)) {
      return new Promise<never>((_resolve, reject) => {
        const rejectAbort = () => {
          const message = 'Offline Product Consultant aborted.';

          this.recordCall({
            callId,

            startedAt,

            error: message,
          });

          reject(new Error(message));
        };

        if (input.signal?.aborted) {
          rejectAbort();

          return;
        }

        if (!input.signal) {
          const message = 'Offline wait-for-abort requires AbortSignal.';

          this.recordCall({
            callId,

            startedAt,

            error: message,
          });

          reject(new Error(message));

          return;
        }

        input.signal.addEventListener(
          'abort',

          rejectAbort,

          {
            once: true,
          },
        );
      });
    }

    this.recordCall({
      callId,

      startedAt,

      error: null,
    });

    return structuredClone(decision);
  }

  private recordCall(input: {
    callId: string;

    startedAt: number;

    error: string | null;
  }): void {
    this.sink?.recordLlmCall({
      callId: input.callId,

      name: 'product_consultant',

      provider: 'offline-stub',

      model: 'offline-stub',

      durationMs: Math.max(
        0,

        Date.now() - input.startedAt,
      ),

      usage: {
        inputTokens: null,

        outputTokens: null,

        totalTokens: null,

        cachedInputTokens: null,

        usageMissing: true,
      },

      error: input.error,
    });
  }
}

function evaluationArtifact(
  artifact: ProductConsultantLoopArtifact,
): EvaluationArtifact {
  switch (artifact.kind) {
    case 'search_results':
      return {
        id: artifact.snapshot.resultId,

        kind: 'search_results',

        data: toEvaluationJson(artifact.snapshot),
      };

    case 'product_details':
      return {
        id: artifact.product.id,

        kind: 'product_details',

        data: toEvaluationJson(artifact.product),
      };

    case 'product_comparison':
      return {
        id: artifact.comparison.comparisonId,

        kind: 'product_comparison',

        data: toEvaluationJson(artifact.comparison),
      };
  }
}

function evaluationOutcome(
  outcome: ProductConsultantLoopOutcome,
): 'answer' | 'interrupt' | 'partial' | 'technical_failure' {
  switch (outcome) {
    case 'completed':
      return 'answer';

    case 'cancelled':
      return 'interrupt';

    case 'budget_exhausted':
      return 'partial';

    case 'interpretation_error':
    case 'model_error':
    case 'timeout':
    case 'capability_error':
      return 'technical_failure';
  }
}

export class OfflineProductConsultantLoopTarget
  implements EvaluationTargetAdapter
{
  readonly target = 'product_consultation' as const;

  private readonly catalog: FrozenCurrentProductCatalog;

  constructor(
    fixture: CurrentProductConsultationFixture,

    private readonly decisions: TurnDecisionRegistry,

    private readonly options: OfflineProductConsultantLoopTargetOptions = {},
  ) {
    this.catalog = new FrozenCurrentProductCatalog(fixture);
  }

  public async runTurn({
    turn,

    state,

    toolCallSink,

    llmCallSink,
  }: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    if (turn.kind !== 'message') {
      throw new Error(
        'OfflineProductConsultantLoopTarget supports only message turns.',
      );
    }

    const queuedDecisions = this.decisions[turn.id];

    if (queuedDecisions === undefined) {
      throw new Error(
        `OfflineProductConsultantLoopTarget: decisions for turn ${turn.id} are missing.`,
      );
    }

    const initialRecord =
      state === null ? null : ConsultationApplicationRecordSchema.parse(state);

    const store = new SingleRecordConsultationStore(initialRecord);

    const baseSearch: ProductSearchPort = new CurrentStoreSearchSpecAdapter(
      this.catalog,
    );

    const productSearch = createEvaluationCapabilityProxy<ProductSearchPort>({
      target: baseSearch,

      getSink: () => toolCallSink ?? null,

      definitions: [
        {
          method: 'search',

          name: 'search_products',

          mapArgs: (args) => toEvaluationJson(args[0]),

          mapResult: (result) => ({
            count: Array.isArray(result) ? result.length : 0,
          }),
        },
      ],
    });

    const baseDetails: ProductDetailsPort = this.catalog;

    const productDetails = createEvaluationCapabilityProxy<ProductDetailsPort>({
      target: baseDetails,

      getSink: () => toolCallSink ?? null,

      definitions: [
        {
          method: 'getProductDetails',

          name: 'get_product_details',

          mapArgs: (args) => ({
            productIds: Array.isArray(args[0]) ? args[0] : [],
          }),

          mapResult: (result) => ({
            count: Array.isArray(result) ? result.length : 0,
          }),
        },
      ],
    });

    let memoryId = 0;

    let executionId = 0;

    let resultId = 0;

    const writeOwner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createMemoryId: () => `memory-${turn.id}-${++memoryId}`,

        createExecutionId: () => `execution-${turn.id}-${++executionId}`,

        createResultId: () => `result-${turn.id}-${++resultId}`,
      },
    );

    const model = new OfflineProductConsultantModel(
      queuedDecisions,

      llmCallSink ?? null,
    );

    const loop = new ProductConsultantLoop(
      store,

      writeOwner,

      productDetails,

      model,

      {
        modelTimeoutMs: this.options.modelTimeoutMs,
      },
    );

    const result = await loop.run({
      conversationId: 'offline-product-consultant',

      requestId: turn.messageId ?? turn.id,

      currentMessage: turn.message,

      signal: this.options.signal,
    });

    return {
      stateAfter: toEvaluationJson(result.record),

      outcome: evaluationOutcome(result.outcome),

      finalText: result.text,

      artifacts: result.artifacts.map(evaluationArtifact),

      resultMetadata: {
        loopOutcome: result.outcome,

        modelCalls: result.modelCalls,

        capabilityRounds: result.capabilityRounds,

        revision: result.record.revision,

        generation: result.record.generation,

        activeResultId: result.record.results.active?.resultId ?? null,
      },
    };
  }
}
