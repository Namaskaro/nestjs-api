import { AiService } from '@/src/ai/ai.service';

import { createProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { SearchSpecSchema } from '../../core/search/search-spec.schema';
import {
  ProductWorkspaceSchema,
  createProductWorkspace,
} from '../../application/workspace/product-workspace';

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
  const spec = SearchSpecSchema.parse(args[0]);
  return {
    query: spec.semanticIntent,
    category: spec.category,
    constraints: toJson(spec.constraints),
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
          method: 'search',

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

          workspace:
            state === null
              ? createProductWorkspace()
              : ProductWorkspaceSchema.parse(state),
          conversationId: 'product-consultation-evaluation',
          requestId: turn.messageId ?? turn.id,
        },
        {
          callbacks,
        },
      );

      const finalText =
        typeof result.message === 'string' ? result.message : null;

      return {
        stateAfter: toJson(result.workspace),

        outcome: finalText ? 'answer' : 'technical_failure',

        finalText,

        artifacts: this.collectArtifacts(result),

        resultMetadata: {
          searchResultGroups: result.groups.length,

          returnedProducts: result.groups.reduce(
            (count, group) => count + group.products.length,
            0,
          ),

          hasConsultationResult:
            result.groups.some((group) => group.presentations?.length) ||
            result.consultation !== null,

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

    for (const group of result.groups) {
      if (group.products.length || group.status === 'empty') {
        artifacts.push({
          id: group.taskId ?? null,
          kind: 'search_results',
          data: {
            taskId: group.taskId ?? null,
            productIds: group.products.map((product) => product.id),
            count: group.products.length,
          },
        });
      }
      for (const presentation of group.presentations ?? []) {
        artifacts.push({
          id: group.taskId
            ? `${group.taskId}:${presentation.actionOrdinal}`
            : null,
          kind:
            presentation.kind === 'details'
              ? 'product_details'
              : presentation.kind,
          data: toJson(
            presentation.kind === 'recommendation'
              ? presentation
              : presentation.data,
          ),
        });
      }
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
