import { AiService } from '@/src/ai/ai.service';

import { createProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import {
  EvaluationJsonValueSchema,
  type EvaluationJsonValue,
} from '../contracts/evaluation-scenario';

import type { EvaluationArtifact } from '../contracts/evaluation-observation';

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

export class CurrentProductConsultationTarget
  implements EvaluationTargetAdapter
{
  readonly target = 'product_consultation' as const;

  private readonly productAgent;

  constructor(
    aiService: AiService,

    productAgentService: ProductAgentService,
  ) {
    this.productAgent = createProductAgent(aiService, productAgentService);
  }

  async runTurn({
    turn,
    state,
    callbacks,
  }: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    if (turn.kind !== 'message') {
      throw new Error(
        'CurrentProductConsultationTarget: текущий ProductAgent не поддерживает resume turn напрямую',
      );
    }

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
