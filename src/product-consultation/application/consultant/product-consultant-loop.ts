import type {
  AgentComparisonView,
  ProductDetails,
} from '../../core/consultation-core.schema';

import type { PublicConsultationAction } from '../../core/turn/consultation-turn.schema';

import type { SearchResultSnapshot } from '../../core/results/consultation-results.schema';

import { compareConsultationProducts } from '../comparison/deterministic-product-comparison';

import type { ProductDetailsPort } from '../catalog/product-details.port';

import {
  buildProductConsultationContext,
  type ProductConsultationContextMessage,
} from '../context/product-consultation-context';

import {
  createConsultationApplicationRecord,
  type ConsultationApplicationRecord,
} from '../runtime/consultation-application-record';

import type { ConsultationApplicationStore } from '../runtime/consultation-application-store.port';

import { ConsultationWriteOwner } from '../runtime/consultation-write-owner';

import {
  ProductConsultantDecisionSchema,
  type ProductConsultantDecision,
} from './product-consultant-decision.schema';

import type {
  ProductConsultantModelPort,
  ProductConsultantRoundObservation,
} from './product-consultant-model.port';

const INTERPRETATION_ERROR_TEXT =
  'Не удалось корректно понять запрос. Попробуйте сформулировать его немного иначе.';

const MODEL_ERROR_TEXT =
  'Не удалось получить ответ консультанта. Попробуйте ещё раз.';

const MODEL_TIMEOUT_TEXT =
  'Консультант не успел ответить вовремя. Попробуйте ещё раз.';

const CANCELLED_TEXT = 'Запрос отменён.';

const CAPABILITY_ERROR_TEXT =
  'Не удалось выполнить действие с каталогом. Попробуйте ещё раз.';

const ROUND_BUDGET_ERROR_TEXT =
  'Не удалось завершить консультацию за этот ход. Попробуйте уточнить запрос.';

/**
 * Пока deliberately жёсткий loop:
 *
 * максимум два model calls
 * и одна capability.
 */
const MAX_MODEL_CALLS_PER_TURN = 2;

const MAX_CAPABILITY_ROUNDS_PER_TURN = 1;

/**
 * Первый безопасный production guardrail.
 *
 * Потом откалибруем по traces.
 */
const DEFAULT_MODEL_TIMEOUT_MS = 15_000;

const SECOND_ROUND_TERMINAL_ACTIONS = new Set<PublicConsultationAction>([
  'COMPLETE',

  'CLARIFY',

  'HANDOFF',
]);

export type ProductConsultantLoopArtifact =
  | {
      kind: 'search_results';

      snapshot: SearchResultSnapshot;
    }
  | {
      kind: 'product_details';

      product: ProductDetails;
    }
  | {
      kind: 'product_comparison';

      comparison: AgentComparisonView;
    };

export type ProductConsultantLoopOutcome =
  | 'completed'
  | 'interpretation_error'
  | 'model_error'
  | 'timeout'
  | 'cancelled'
  | 'capability_error'
  | 'budget_exhausted';

export type ProductConsultantLoopInput = {
  conversationId: string;

  requestId: string;

  currentMessage: string;

  recentMessages?: readonly ProductConsultationContextMessage[];

  /**
   * Внешняя отмена HTTP request /
   * higher-level execution.
   */
  signal?: AbortSignal;
};

export type ProductConsultantLoopOptions = {
  /**
   * Timeout одного model call.
   *
   * Не всего пользовательского turn.
   */
  modelTimeoutMs?: number;
};

export type ProductConsultantLoopResult = {
  outcome: ProductConsultantLoopOutcome;

  text: string;

  record: ConsultationApplicationRecord;

  artifacts: ProductConsultantLoopArtifact[];

  modelCalls: number;

  capabilityRounds: number;
};

type CapabilityExecution = {
  record: ConsultationApplicationRecord;

  observation: ProductConsultantRoundObservation;

  artifacts: ProductConsultantLoopArtifact[];

  selectedProducts: ProductDetails[];

  comparison: AgentComparisonView | null;
};

type ModelCallResult =
  | {
      kind: 'success';

      decision: ProductConsultantDecision;
    }
  | {
      kind: 'interpretation_error';
    }
  | {
      kind: 'model_error';
    }
  | {
      kind: 'timeout';
    }
  | {
      kind: 'cancelled';
    };

class ProductConsultantModelAbortError extends Error {
  constructor() {
    super('Product Consultant model call aborted.');

    this.name = 'ProductConsultantModelAbortError';
  }
}

function orderedProducts(
  productIds: readonly string[],

  products: readonly ProductDetails[],
): ProductDetails[] {
  const byId = new Map(products.map((product) => [product.id, product]));

  return productIds.flatMap((productId) => {
    const product = byId.get(productId);

    return product ? [product] : [];
  });
}

function isSecondRoundTerminalDecision(
  decision: ProductConsultantDecision,
): boolean {
  if (!SECOND_ROUND_TERMINAL_ACTIONS.has(decision.proposal.action)) {
    return false;
  }

  if (decision.proposal.taskTransition !== 'continue') {
    return false;
  }

  if (decision.proposal.search !== null) {
    return false;
  }

  if (decision.proposal.searchPatch !== null) {
    return false;
  }

  if (decision.proposal.memoryObservations.length > 0) {
    return false;
  }

  if (decision.proposal.selection !== null) {
    return false;
  }

  if (decision.proposal.feedback !== null) {
    return false;
  }

  return decision.terminalText !== null;
}

export class ProductConsultantLoop {
  private readonly modelTimeoutMs: number;

  constructor(
    private readonly store: ConsultationApplicationStore,

    private readonly writeOwner: ConsultationWriteOwner,

    private readonly productDetails: ProductDetailsPort,

    private readonly model: ProductConsultantModelPort,

    options: ProductConsultantLoopOptions = {},
  ) {
    this.modelTimeoutMs = options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

    if (!Number.isFinite(this.modelTimeoutMs) || this.modelTimeoutMs <= 0) {
      throw new Error(
        'ProductConsultantLoop: modelTimeoutMs must be a positive finite number.',
      );
    }
  }

  public async run(
    input: ProductConsultantLoopInput,
  ): Promise<ProductConsultantLoopResult> {
    let modelCalls = 0;

    let capabilityRounds = 0;

    const artifacts: ProductConsultantLoopArtifact[] = [];

    const stored = await this.store.load(input.conversationId);

    let record = stored ?? createConsultationApplicationRecord();

    /**
     * Уже отменённый request
     * вообще не вызывает модель
     * и ничего не пишет.
     */
    if (input.signal?.aborted) {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    const initialContext = buildProductConsultationContext({
      record,

      currentMessage: input.currentMessage,

      recentMessages: input.recentMessages ?? [],
    });

    const firstDecisionResult = await this.callModel({
      context: initialContext.context,

      observation: {
        kind: 'initial',
      },

      round: 1,

      signal: input.signal,
    });

    modelCalls += 1;

    if (firstDecisionResult.kind === 'cancelled') {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (firstDecisionResult.kind === 'timeout') {
      return {
        outcome: 'timeout',

        text: MODEL_TIMEOUT_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (firstDecisionResult.kind === 'model_error') {
      return {
        outcome: 'model_error',

        text: MODEL_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (firstDecisionResult.kind === 'interpretation_error') {
      return {
        outcome: 'interpretation_error',

        text: INTERPRETATION_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    const firstDecision = firstDecisionResult.decision;

    /**
     * Request могли отменить
     * сразу после ответа модели.
     *
     * Тогда authoritative state
     * ещё не трогаем.
     */
    if (input.signal?.aborted) {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    let execution: Awaited<ReturnType<ConsultationWriteOwner['execute']>>;

    try {
      /**
       * РОВНО ОДИН WriteOwner
       * на пользовательский turn.
       */
      execution = await this.writeOwner.execute({
        conversationId: input.conversationId,

        expectedRevision: initialContext.expectedRevision,

        requestId: input.requestId,

        proposal: firstDecision.proposal,

        expectedResultId: initialContext.expectedResultId,
      });
    } catch {
      return {
        outcome: 'capability_error',

        text: CAPABILITY_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    record = execution.record;

    /**
     * SearchPort сейчас не принимает
     * AbortSignal.
     *
     * Поэтому если cancellation
     * произошёл ВО ВРЕМЯ WriteOwner /
     * search, мы не откатываем уже
     * успешно подтверждённый state.
     *
     * Но новые действия после него
     * не запускаем.
     */
    if (input.signal?.aborted) {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (firstDecision.terminalText !== null) {
      return {
        outcome: 'completed',

        text: firstDecision.terminalText,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (capabilityRounds >= MAX_CAPABILITY_ROUNDS_PER_TURN) {
      return {
        outcome: 'budget_exhausted',

        text: ROUND_BUDGET_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (input.signal?.aborted) {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    let capability: CapabilityExecution;

    try {
      capability = await this.executeCapability(
        firstDecision,

        execution,
      );
    } catch {
      return {
        outcome: 'capability_error',

        text: CAPABILITY_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    capabilityRounds += 1;

    record = capability.record;

    artifacts.push(...capability.artifacts);

    if (input.signal?.aborted) {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    const followUpContext = buildProductConsultationContext({
      record,

      currentMessage: input.currentMessage,

      recentMessages: input.recentMessages ?? [],

      selectedProducts: capability.selectedProducts,

      comparison: capability.comparison,

      usageScenarioIds: firstDecision.usageScenarioIds,
    });

    if (modelCalls >= MAX_MODEL_CALLS_PER_TURN) {
      return {
        outcome: 'budget_exhausted',

        text: ROUND_BUDGET_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    const secondDecisionResult = await this.callModel({
      context: followUpContext.context,

      observation: capability.observation,

      round: 2,

      signal: input.signal,
    });

    modelCalls += 1;

    if (secondDecisionResult.kind === 'cancelled') {
      return {
        outcome: 'cancelled',

        text: CANCELLED_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (secondDecisionResult.kind === 'timeout') {
      return {
        outcome: 'timeout',

        text: MODEL_TIMEOUT_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (secondDecisionResult.kind === 'model_error') {
      return {
        outcome: 'model_error',

        text: MODEL_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    if (secondDecisionResult.kind === 'interpretation_error') {
      return {
        outcome: 'interpretation_error',

        text: INTERPRETATION_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    const secondDecision = secondDecisionResult.decision;

    /**
     * Call #2 только завершает turn.
     *
     * Никакого второго:
     *
     * - SEARCH;
     * - REFINE;
     * - Memory mutation;
     * - feedback;
     * - start_new.
     */
    if (!isSecondRoundTerminalDecision(secondDecision)) {
      return {
        outcome: 'budget_exhausted',

        text: ROUND_BUDGET_ERROR_TEXT,

        record,

        artifacts,

        modelCalls,

        capabilityRounds,
      };
    }

    return {
      outcome: 'completed',

      text: secondDecision.terminalText!,

      record,

      artifacts,

      modelCalls,

      capabilityRounds,
    };
  }

  private async callModel(input: {
    context: Parameters<ProductConsultantModelPort['decide']>[0]['context'];

    observation: ProductConsultantRoundObservation;

    round: 1 | 2;

    signal?: AbortSignal;
  }): Promise<ModelCallResult> {
    if (input.signal?.aborted) {
      return {
        kind: 'cancelled',
      };
    }

    const controller = new AbortController();

    let timedOut = false;

    let externallyCancelled = false;

    const onExternalAbort = () => {
      externallyCancelled = true;

      controller.abort(input.signal?.reason);
    };

    input.signal?.addEventListener(
      'abort',

      onExternalAbort,

      {
        once: true,
      },
    );

    const timeout = setTimeout(
      () => {
        timedOut = true;

        controller.abort(new Error('Product Consultant model timeout.'));
      },

      this.modelTimeoutMs,
    );

    let removeInternalAbortListener = () => {};

    const abortPromise = new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        reject(new ProductConsultantModelAbortError());
      };

      if (controller.signal.aborted) {
        onAbort();

        return;
      }

      controller.signal.addEventListener(
        'abort',

        onAbort,

        {
          once: true,
        },
      );

      removeInternalAbortListener = () => {
        controller.signal.removeEventListener(
          'abort',

          onAbort,
        );
      };
    });

    let raw: unknown;

    try {
      raw = await Promise.race([
        this.model.decide({
          context: input.context,

          observation: input.observation,

          round: input.round,

          signal: controller.signal,
        }),

        abortPromise,
      ]);

      /**
       * На случай почти
       * одновременного resolve + abort.
       */
      if (timedOut) {
        return {
          kind: 'timeout',
        };
      }

      if (externallyCancelled || input.signal?.aborted) {
        return {
          kind: 'cancelled',
        };
      }
    } catch {
      if (timedOut) {
        return {
          kind: 'timeout',
        };
      }

      if (externallyCancelled || input.signal?.aborted) {
        return {
          kind: 'cancelled',
        };
      }

      return {
        kind: 'model_error',
      };
    } finally {
      clearTimeout(timeout);

      input.signal?.removeEventListener(
        'abort',

        onExternalAbort,
      );

      removeInternalAbortListener();
    }

    const parsed = ProductConsultantDecisionSchema.safeParse(raw);

    if (!parsed.success) {
      return {
        kind: 'interpretation_error',
      };
    }

    return {
      kind: 'success',

      decision: parsed.data,
    };
  }

  private async executeCapability(
    decision: ProductConsultantDecision,

    execution: Awaited<ReturnType<ConsultationWriteOwner['execute']>>,
  ): Promise<CapabilityExecution> {
    const action = decision.proposal.action;

    switch (action) {
      case 'SEARCH':
      case 'REFINE': {
        if (execution.status === 'search_failed') {
          return {
            record: execution.record,

            observation: {
              kind: 'search',

              status: 'failed',

              count: null,
            },

            artifacts: [],

            selectedProducts: [],

            comparison: null,
          };
        }

        if (execution.status === 'search_succeeded') {
          const snapshot = execution.record.results.active;

          if (snapshot === null) {
            throw new Error(
              'ProductConsultantLoop: successful search has no active snapshot.',
            );
          }

          const count = snapshot.products.length;

          return {
            record: execution.record,

            observation: {
              kind: 'search',

              status: count === 0 ? 'zero_results' : 'succeeded',

              count,
            },

            artifacts: [
              {
                kind: 'search_results',

                snapshot,
              },
            ],

            selectedProducts: [],

            comparison: null,
          };
        }

        if (execution.status === 'accepted') {
          return {
            record: execution.record,

            observation: {
              kind: 'search',

              status: 'no_change',

              count: execution.record.results.active?.products.length ?? null,
            },

            artifacts: [],

            selectedProducts: [],

            comparison: null,
          };
        }

        throw new Error(
          `ProductConsultantLoop: unsupported search execution status ${execution.status}.`,
        );
      }

      case 'SHOW_RESULTS': {
        if (execution.status !== 'accepted') {
          throw new Error(
            `ProductConsultantLoop: SHOW_RESULTS returned ${execution.status}.`,
          );
        }

        const snapshot = execution.record.results.active;

        if (snapshot === null) {
          return {
            record: execution.record,

            observation: {
              kind: 'show_results',

              status: 'missing',

              count: 0,
            },

            artifacts: [],

            selectedProducts: [],

            comparison: null,
          };
        }

        return {
          record: execution.record,

          observation: {
            kind: 'show_results',

            status: 'ready',

            count: snapshot.products.length,
          },

          artifacts: [
            {
              kind: 'search_results',

              snapshot,
            },
          ],

          selectedProducts: [],

          comparison: null,
        };
      }

      case 'DETAILS': {
        if (execution.status !== 'accepted') {
          throw new Error(
            `ProductConsultantLoop: DETAILS returned ${execution.status}.`,
          );
        }

        const selection = execution.resolvedSelection;

        if (selection === null || selection.productIds.length !== 1) {
          throw new Error(
            'ProductConsultantLoop: DETAILS has no resolved product.',
          );
        }

        const fresh = await this.productDetails.getProductDetails(
          selection.productIds,
        );

        const products = orderedProducts(
          selection.productIds,

          fresh,
        );

        if (products.length !== selection.productIds.length) {
          return {
            record: execution.record,

            observation: {
              kind: 'details',

              status: 'product_unavailable',
            },

            artifacts: [],

            selectedProducts: [],

            comparison: null,
          };
        }

        return {
          record: execution.record,

          observation: {
            kind: 'details',

            status: 'ready',
          },

          artifacts: [
            {
              kind: 'product_details',

              product: products[0]!,
            },
          ],

          selectedProducts: products,

          comparison: null,
        };
      }

      case 'COMPARE': {
        if (execution.status !== 'accepted') {
          throw new Error(
            `ProductConsultantLoop: COMPARE returned ${execution.status}.`,
          );
        }

        const selection = execution.resolvedSelection;

        if (selection === null || selection.productIds.length < 2) {
          throw new Error(
            'ProductConsultantLoop: COMPARE has no resolved products.',
          );
        }

        const fresh = await this.productDetails.getProductDetails(
          selection.productIds,
        );

        const products = orderedProducts(
          selection.productIds,

          fresh,
        );

        if (products.length !== selection.productIds.length) {
          return {
            record: execution.record,

            observation: {
              kind: 'compare',

              status: 'product_unavailable',
            },

            artifacts: [],

            selectedProducts: [],

            comparison: null,
          };
        }

        const state = execution.record.state;

        if (state === null) {
          throw new Error(
            'ProductConsultantLoop: COMPARE requires consultation state.',
          );
        }

        const compared = compareConsultationProducts({
          state,

          productIds: selection.productIds,

          products,

          attributeIds: null,
        });

        return {
          record: execution.record,

          observation: {
            kind: 'compare',

            status: 'ready',
          },

          artifacts: [
            {
              kind: 'product_comparison',

              comparison: compared,
            },
          ],

          selectedProducts: products,

          comparison: compared,
        };
      }

      case 'RECOMMEND': {
        if (execution.status !== 'accepted') {
          throw new Error(
            `ProductConsultantLoop: RECOMMEND returned ${execution.status}.`,
          );
        }

        const selection = execution.resolvedSelection;

        if (selection === null || selection.productIds.length < 1) {
          throw new Error(
            'ProductConsultantLoop: RECOMMEND has no resolved candidates.',
          );
        }

        const fresh = await this.productDetails.getProductDetails(
          selection.productIds,
        );

        const products = orderedProducts(
          selection.productIds,

          fresh,
        );

        if (products.length !== selection.productIds.length) {
          return {
            record: execution.record,

            observation: {
              kind: 'recommend',

              status: 'product_unavailable',
            },

            artifacts: [],

            selectedProducts: [],

            comparison: null,
          };
        }

        return {
          record: execution.record,

          observation: {
            kind: 'recommend',

            status: 'context_ready',
          },

          /**
           * Совет сам по себе
           * не создаёт UI cards.
           */
          artifacts: [],

          selectedProducts: products,

          comparison: null,
        };
      }

      default: {
        throw new Error(
          `ProductConsultantLoop: action ${action} is not a capability action.`,
        );
      }
    }
  }
}
