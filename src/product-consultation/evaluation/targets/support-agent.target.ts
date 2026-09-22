import { randomUUID } from 'node:crypto';

import { HumanMessage } from '@langchain/core/messages';

import { Command, isInterrupted } from '@langchain/langgraph';

import { SupportAgentGraph } from '@/src/support-agent/graph/support-agent.graph';

import { SupportAgentResumeSchema } from '@/src/support-agent/schemas/support-agent-resume.schema';

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

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    return null;
  }

  return EvaluationJsonValueSchema.parse(JSON.parse(serialized));
}

function collectArtifacts(answer: unknown): EvaluationArtifact[] {
  if (typeof answer !== 'object' || answer === null) {
    return [];
  }

  const value = answer as Record<string, unknown>;

  const artifacts: EvaluationArtifact[] = [];

  const collectProductData = (productData: Record<string, unknown>) => {
    const groups = productData.groups;

    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (typeof group !== 'object' || group === null) {
          continue;
        }

        const groupValue = group as Record<string, unknown>;

        const products = Array.isArray(groupValue.products)
          ? groupValue.products
          : [];

        const productIds = products.flatMap((product) => {
          if (typeof product !== 'object' || product === null) {
            return [];
          }

          const id = (product as Record<string, unknown>).id;

          return typeof id === 'string' ? [id] : [];
        });

        artifacts.push({
          id: null,

          kind: 'search_results',

          data: {
            productIds,

            count: productIds.length,
          },
        });
      }
    }

    const consultation = productData.consultation;

    if (typeof consultation === 'object' && consultation !== null) {
      const consultationValue = consultation as Record<string, unknown>;

      if (consultationValue.comparisonPresentation) {
        artifacts.push({
          id: null,

          kind: 'comparison',

          data: toJson(consultationValue.comparisonPresentation),
        });
      }

      if (consultationValue.productDetailsPresentation) {
        artifacts.push({
          id: null,

          kind: 'product_details',

          data: toJson(consultationValue.productDetailsPresentation),
        });
      }
    }
  };

  if (value.type === 'product_agent') {
    collectProductData(value);
  }

  if (value.type === 'aggregate' && Array.isArray(value.blocks)) {
    for (const block of value.blocks) {
      if (typeof block !== 'object' || block === null) {
        continue;
      }

      const blockValue = block as Record<string, unknown>;

      if (blockValue.worker !== 'product_search') {
        continue;
      }

      if (typeof blockValue.data === 'object' && blockValue.data !== null) {
        collectProductData(blockValue.data as Record<string, unknown>);
      }
    }
  }

  return artifacts;
}

export class SupportAgentEvaluationTarget implements EvaluationTargetAdapter {
  readonly target = 'support_agent' as const;

  private readonly graph;

  private readonly threadId: string;

  private initialized = false;

  constructor(
    supportAgentGraph: SupportAgentGraph,

    threadId = `evaluation-${randomUUID()}`,
  ) {
    this.graph = supportAgentGraph.getCompiledGraph();

    this.threadId = threadId;
  }

  async runTurn({
    turn,
    state,
    callbacks,
  }: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    const config = {
      configurable: {
        thread_id: this.threadId,
      },

      callbacks,
    };

    /**
     * Initial state загружаем только один раз.
     *
     * Дальше source of truth для multi-turn scenario —
     * checkpoint самого SupportAgent.
     */
    if (!this.initialized) {
      if (state !== null) {
        await this.graph.updateState(config, state);
      }

      this.initialized = true;
    }

    const result =
      turn.kind === 'message'
        ? await this.graph.invoke(
            {
              query: turn.message,

              messages: [
                new HumanMessage({
                  content: turn.message,

                  ...(turn.messageId
                    ? {
                        id: turn.messageId,
                      }
                    : {}),
                }),
              ],
            },

            config,
          )
        : await this.graph.invoke(
            new Command({
              resume: SupportAgentResumeSchema.parse(turn.value),
            }),

            config,
          );

    if (isInterrupted(result)) {
      return {
        stateAfter: toJson(result),

        outcome: 'interrupt',

        finalText: null,

        artifacts: [],

        resultMetadata: {
          interrupted: true,

          threadId: this.threadId,
        },
      };
    }

    const answer = result.answer;

    const finalText =
      answer && typeof answer.message === 'string' ? answer.message : null;

    return {
      stateAfter: toJson(result),

      outcome: finalText ? 'answer' : 'technical_failure',

      finalText,

      artifacts: collectArtifacts(answer),

      resultMetadata: {
        threadId: this.threadId,

        answerType: answer?.type ?? null,

        hasHandoff: result.handoff != null,
      },
    };
  }
}
