import { AiService } from '@/src/ai/ai.service';

import { createProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

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

function jsonArgs(args: readonly unknown[]): EvaluationJsonValue {
  const serialized = JSON.stringify(args);

  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized) as EvaluationJsonValue;
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

          mapArgs: jsonArgs,
        },

        {
          method: 'getProductDetails',

          name: 'get_product_details',

          mapArgs: jsonArgs,
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

    return artifacts;
  }
}
