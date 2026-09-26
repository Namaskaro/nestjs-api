import type { ConsultationApplicationRecord } from '../../application/runtime/consultation-application-record';

import { ConsultationApplicationRecordSchema } from '../../application/runtime/consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from '../../application/runtime/consultation-application-store.port';

import { ConsultationWriteOwner } from '../../application/runtime/consultation-write-owner';

import type { ProductDetailsPort } from '../../application/catalog/product-details.port';

import { compareConsultationProducts } from '../../application/comparison/deterministic-product-comparison';

import type { ProductSearchPort } from '../../application/search/product-search.port';

import { CurrentStoreSearchSpecAdapter } from '../../adapters/current-store/current-store-search-spec.adapter';

import { ConsultationTurnProposalSchema } from '../../core/turn/consultation-turn-proposal.schema';

import type { EvaluationArtifact } from '../contracts/evaluation-observation';

import {
  EvaluationJsonValueSchema,
  type EvaluationJsonValue,
} from '../contracts/evaluation-scenario';

import {
  FrozenCurrentProductCatalog,
  type CurrentProductConsultationFixture,
} from '../fixtures/current-product-consultation.fixture';

import { createEvaluationCapabilityProxy } from '../recording/evaluation-capability-proxy';

import type {
  EvaluationTargetAdapter,
  EvaluationTargetRunInput,
  EvaluationTargetRunResult,
} from './evaluation-target';

type OfflineProposalRegistry = Readonly<Record<string, unknown>>;

export type OfflineProductConsultationTargetOptions = {
  /**
   * Test-only server metadata override.
   *
   * Позволяет проверить stale/wrong snapshot.
   *
   * Это НЕ значение из proposal
   * и НЕ значение, придуманное моделью.
   */
  expectedResultIdByTurn?: Readonly<Record<string, string | null>>;
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
    return this.record
      ? ConsultationApplicationRecordSchema.parse(structuredClone(this.record))
      : null;
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

function hasOwn(
  value: object,

  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    value,

    key,
  );
}

export class OfflineProductConsultationTarget
  implements EvaluationTargetAdapter
{
  readonly target = 'product_consultation' as const;

  private readonly frozenCatalog: FrozenCurrentProductCatalog;

  constructor(
    fixture: CurrentProductConsultationFixture,

    private readonly proposals: OfflineProposalRegistry,

    private readonly options: OfflineProductConsultationTargetOptions = {},
  ) {
    this.frozenCatalog = new FrozenCurrentProductCatalog(fixture);
  }

  public async runTurn({
    turn,

    state,

    toolCallSink,
  }: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    if (turn.kind !== 'message') {
      throw new Error(
        'OfflineProductConsultationTarget supports only message turns.',
      );
    }

    const proposalRaw = this.proposals[turn.id];

    if (proposalRaw === undefined) {
      throw new Error(
        `OfflineProductConsultationTarget: proposal for turn ${turn.id} is missing.`,
      );
    }

    const proposal = ConsultationTurnProposalSchema.parse(proposalRaw);

    const initialRecord =
      state === null ? null : ConsultationApplicationRecordSchema.parse(state);

    const store = new SingleRecordConsultationStore(initialRecord);

    const baseSearchPort: ProductSearchPort = new CurrentStoreSearchSpecAdapter(
      this.frozenCatalog,
    );

    const productSearch = createEvaluationCapabilityProxy<ProductSearchPort>({
      target: baseSearchPort,

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

    const baseDetailsPort: ProductDetailsPort = this.frozenCatalog;

    const productDetails = createEvaluationCapabilityProxy<ProductDetailsPort>({
      target: baseDetailsPort,

      getSink: () => toolCallSink ?? null,

      definitions: [
        {
          method: 'getProductDetails',

          name: 'get_product_details',

          mapArgs: (args) => ({
            productIds: Array.isArray(args[0])
              ? args[0].filter(
                  (value): value is string => typeof value === 'string',
                )
              : [],
          }),

          mapResult: (result) => ({
            count: Array.isArray(result) ? result.length : 0,
          }),
        },
      ],
    });

    const comparison = createEvaluationCapabilityProxy({
      target: {
        compareProducts: compareConsultationProducts,
      },

      getSink: () => toolCallSink ?? null,

      definitions: [
        {
          method: 'compareProducts',

          name: 'compare_products',

          mapArgs: (args) => {
            const input = args[0] as {
              productIds?: readonly string[];
            };

            return {
              productIds: input.productIds ? [...input.productIds] : [],
            };
          },

          mapResult: (result) => {
            const value = result as {
              productIds?: readonly string[];

              rows?: readonly unknown[];
            };

            return {
              productIds: value.productIds ? [...value.productIds] : [],

              rowCount: value.rows?.length ?? 0,
            };
          },
        },
      ],
    });

    let memoryId = 0;

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createMemoryId: () => `memory-${turn.id}-${++memoryId}`,

        createExecutionId: () => `execution-${turn.id}`,

        createResultId: () => `result-${turn.id}`,
      },
    );

    const expectedResultOverrides = this.options.expectedResultIdByTurn ?? {};

    /**
     * Обычно expectedResultId —
     * active snapshot текущего context.
     *
     * В adversarial test можно
     * намеренно передать старый/чужой
     * server-owned resultId.
     */
    const expectedResultId = hasOwn(
      expectedResultOverrides,

      turn.id,
    )
      ? expectedResultOverrides[turn.id] ?? null
      : initialRecord?.results.active?.resultId ?? null;

    const result = await owner.execute({
      conversationId: 'offline-product-consultation',

      expectedRevision: initialRecord?.revision ?? 0,

      requestId: turn.messageId ?? turn.id,

      proposal,

      expectedResultId,
    });

    const artifacts: EvaluationArtifact[] = [];

    let operationStatus: string = result.status;

    let recommendationCandidateIds: string[] = [];

    const active = result.record.results.active;

    if (result.status === 'search_succeeded' && active !== null) {
      artifacts.push({
        id: active.resultId,

        kind: 'search_results',

        data: {
          productIds: active.products.map((product) => product.productId),

          count: active.products.length,
        },
      });
    }

    if (result.status === 'accepted' && proposal.action === 'DETAILS') {
      const selection = result.resolvedSelection;

      if (selection === null || selection.productIds.length !== 1) {
        throw new Error(
          'OfflineProductConsultationTarget: DETAILS has no resolved product.',
        );
      }

      const selectedProductId = selection.productIds[0]!;

      const details = await productDetails.getProductDetails([
        selectedProductId,
      ]);

      const product =
        details.find((item) => item.id === selectedProductId) ?? null;

      if (product === null) {
        operationStatus = 'product_unavailable';
      } else {
        operationStatus = 'details_ready';

        artifacts.push({
          id: product.id,

          kind: 'product_details',

          data: toEvaluationJson(product),
        });
      }
    }

    if (result.status === 'accepted' && proposal.action === 'COMPARE') {
      const selection = result.resolvedSelection;

      if (selection === null || selection.productIds.length < 2) {
        throw new Error(
          'OfflineProductConsultationTarget: COMPARE has no resolved products.',
        );
      }

      const details = await productDetails.getProductDetails(
        selection.productIds,
      );

      const detailsById = new Map(
        details.map((product) => [product.id, product]),
      );

      const freshProducts = selection.productIds.flatMap((productId) => {
        const product = detailsById.get(productId);

        return product ? [product] : [];
      });

      if (freshProducts.length !== selection.productIds.length) {
        operationStatus = 'product_unavailable';
      } else {
        const currentState = result.record.state;

        if (currentState === null) {
          throw new Error(
            'OfflineProductConsultationTarget: COMPARE requires consultation state.',
          );
        }

        const compared = comparison.compareProducts({
          state: currentState,

          productIds: selection.productIds,

          products: freshProducts,

          attributeIds: null,
        });

        operationStatus = 'comparison_ready';

        artifacts.push({
          id: compared.comparisonId,

          kind: 'product_comparison',

          data: toEvaluationJson(compared),
        });
      }
    }

    if (result.status === 'accepted' && proposal.action === 'RECOMMEND') {
      const selection = result.resolvedSelection;

      if (selection === null || selection.productIds.length < 1) {
        throw new Error(
          'OfflineProductConsultationTarget: RECOMMEND has no resolved candidates.',
        );
      }

      const details = await productDetails.getProductDetails(
        selection.productIds,
      );

      const detailsById = new Map(
        details.map((product) => [product.id, product]),
      );

      const freshCandidateIds = selection.productIds.filter((productId) =>
        detailsById.has(productId),
      );

      if (freshCandidateIds.length !== selection.productIds.length) {
        operationStatus = 'product_unavailable';
      } else {
        recommendationCandidateIds = freshCandidateIds;

        operationStatus = 'recommendation_context_ready';
      }
    }

    const technicalFailure = result.status === 'search_failed';

    return {
      stateAfter: toEvaluationJson(result.record),

      outcome: technicalFailure ? 'technical_failure' : 'answer',

      finalText: technicalFailure ? null : operationStatus,

      artifacts,

      resultMetadata: {
        status: operationStatus,

        revision: result.record.revision,

        generation: result.record.generation,

        activeResultId: active?.resultId ?? null,

        activeProductCount: active?.products.length ?? null,

        resolvedProductIds: result.resolvedSelection?.productIds ?? [],

        resolvedFeedbackProductIds:
          result.resolvedFeedbackSelection?.productIds ?? [],

        recommendationCandidateIds,
      },
    };
  }
}
