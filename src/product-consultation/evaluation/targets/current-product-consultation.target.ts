import { AiService } from '@/src/ai/ai.service';

import { createProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { ProductNeedSchema } from '@/src/product-consultation/application/search/product-need.schema';

import {
  EvaluationJsonValueSchema,
  type EvaluationJsonValue,
} from '../contracts/evaluation-scenario';

import type { EvaluationArtifact } from '../contracts/evaluation-observation';

import {
  createEvaluationCapabilityProxy,
  type EvaluationToolCallSink,
} from '../recording/evaluation-capability-proxy';

import type {
  EvaluationTargetAdapter,
  EvaluationTargetRunInput,
  EvaluationTargetRunResult,
} from './evaluation-target';

function toJson(value: unknown): EvaluationJsonValue | null {
  if (value === undefined) {
    return null;
  }

  return EvaluationJsonValueSchema.parse(value);
}

function mapSearchArgs(args: readonly unknown[]): EvaluationJsonValue {
  const parsed = ProductNeedSchema.safeParse(args[0]);

  if (!parsed.success) {
    return {
      query: null,

      constraints: null,
    };
  }

  const need = parsed.data;

  return {
    query: need.semanticQuery,

    constraints: {
      gender: need.filters.gender,

      type: need.filters.type,

      brand: need.filters.brand,

      category: need.filters.category,

      subcategory: need.filters.subcategory,

      color: need.filters.color,

      size: need.filters.size,

      minPrice: need.filters.minPrice,

      maxPrice: need.filters.maxPrice,
    },
  };
}

function mapProductDetailsArgs(args: readonly unknown[]): EvaluationJsonValue {
  const productIds = Array.isArray(args[0])
    ? args[0].filter((value): value is string => typeof value === 'string')
    : [];

  return {
    productIds,
  };
}

export class CurrentProductConsultationTarget
  implements EvaluationTargetAdapter
{
  readonly target = 'product_consultation' as const;

  private readonly productAgent;

  private activeToolCallSink: EvaluationToolCallSink | null = null;

  private running = false;

  constructor(
    aiService: AiService,

    productAgentService: ProductAgentService,
  ) {
    const instrumentedService = createEvaluationCapabilityProxy({
      target: productAgentService,

      getSink: () => this.activeToolCallSink,

      definitions: [
        {
          method: 'searchProducts',

          name: 'search_products',

          mapArgs: mapSearchArgs,
        },

        {
          method: 'getProductDetails',

          name: 'get_product_details',

          mapArgs: mapProductDetailsArgs,
        },
      ],
    });

    this.productAgent = createProductAgent(aiService, instrumentedService);
  }

  async runTurn({
    turn,
    state,
    callbacks,
    toolCallSink,
  }: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    if (this.running) {
      throw new Error(
        'CurrentProductConsultationTarget: один target нельзя запускать параллельно',
      );
    }

    if (turn.kind !== 'message') {
      throw new Error(
        'CurrentProductConsultationTarget: текущий ProductAgent не поддерживает resume turn напрямую',
      );
    }

    this.running = true;

    this.activeToolCallSink = toolCallSink ?? null;

    try {
      const result = await this.productAgent.invoke(
        {
          query: turn.message,

          productContext: state,
        },
        {
          callbacks,
        },
      );

      const finalText =
        typeof result.message === 'string' ? result.message : null;

      return {
        stateAfter: toJson(result.productContext),

        outcome: finalText ? 'answer' : 'technical_failure',

        finalText,

        artifacts: this.collectArtifacts(result),

        resultMetadata: {
          searchResultGroups: result.searchResults.length,

          returnedProducts: result.searchResults.reduce(
            (count, group) => count + group.products.length,
            0,
          ),

          hasConsultationResult: result.consultation !== null,

          hasCompletionPresentation: result.consultationCompletion !== null,
        },
      };
    } finally {
      this.activeToolCallSink = null;

      this.running = false;
    }
  }

  private collectArtifacts(
    result: Awaited<
      ReturnType<ReturnType<typeof createProductAgent>['invoke']>
    >,
  ): EvaluationArtifact[] {
    const artifacts: EvaluationArtifact[] = [];

    for (const searchResult of result.searchResults) {
      artifacts.push({
        id: null,

        kind: 'search_results',

        data: {
          productIds: searchResult.products.map((product) => product.id),

          count: searchResult.products.length,
        },
      });
    }

    const comparisonPresentation = result.consultation?.comparisonPresentation;

    if (comparisonPresentation) {
      artifacts.push({
        id: null,

        kind: 'comparison',

        data: toJson(comparisonPresentation),
      });
    }

    const productDetailsPresentation =
      result.consultation?.productDetailsPresentation;

    if (productDetailsPresentation) {
      artifacts.push({
        id: null,

        kind: 'product_details',

        data: toJson(productDetailsPresentation),
      });
    }

    if (result.consultationCompletion) {
      artifacts.push({
        id: result.consultationCompletion.sessionId,

        kind: 'consultation_completion',

        data: toJson(result.consultationCompletion),
      });
    }

    return artifacts;
  }
}
