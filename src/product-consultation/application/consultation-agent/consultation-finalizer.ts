import { z } from 'zod';
import { ConsultationCore } from '../../../../../product-consultation/core/consultation-core';
import type { RecommendationReason } from '../../consultation-core/consultation-core.schema';
import {
  ConsultationAgentResultSchema,
  ConsultationDecisionSchema,
  type ConsultationAgentInput,
  type ConsultationAgentResult,
} from './schemas/consultation-agent.schema';
import { ConsultationCompletionOutputSchema } from './schemas/consultation-completion.schema';

class InvalidCompletion extends Error {}

const reject = (): never => {
  throw new InvalidCompletion('Invalid consultation output');
};

const keyOf = (value: { needId: string; productId: string }) =>
  JSON.stringify([value.needId, value.productId]);

export function finalizeConsultation(
  input: ConsultationAgentInput,
  rawCompletion: unknown,
  core: ConsultationCore,
) {
  const current = new Map(
    input.searches.map(
      (search) =>
        [search.needId, core.referenceOptions(search.needId)] as const,
    ),
  );

  const artifacts = core.currentArtifacts();

  const fallback = (): ConsultationAgentResult =>
    ConsultationAgentResultSchema.parse({
      message:
        artifacts.comparisons.length || artifacts.productDetails.length
          ? 'Ниже — проверенные сведения о выбранных товарах.'
          : 'Недостаточно проверенных данных для рекомендации.',
      decisions: input.searches.map((search) => ({
        needId: search.needId,
        query: search.query,
        nextAction: 'SHOW_RESULTS',
        suggestedFields: [],
        alternativePlan: null,
        question: null,
      })),
      recommendations: [],
      ...artifacts,
    });

  let result: ConsultationAgentResult;

  try {
    const completion = ConsultationCompletionOutputSchema.parse(rawCompletion);

    const decisionMap = new Map(
      completion.decisions.map((decision) => [decision.needId, decision]),
    );

    if (
      decisionMap.size !== input.searches.length ||
      decisionMap.size !== completion.decisions.length
    ) {
      reject();
    }

    const decisions = input.searches.map((search) => {
      const decision = decisionMap.get(search.needId) ?? reject();

      core.assertMemoryRevision(search.needId, decision.memoryRevision);

      if (
        (decision.alternativeStrategy === null) !==
        (decision.alternativeDescription === null)
      ) {
        reject();
      }

      return ConsultationDecisionSchema.parse({
        needId: search.needId,
        query: search.query,
        nextAction: decision.nextAction,
        suggestedFields:
          decision.suggestedField === null ? [] : [decision.suggestedField],
        alternativePlan:
          decision.alternativeStrategy === null
            ? null
            : {
                strategy: decision.alternativeStrategy,
                description: decision.alternativeDescription,
              },
        question: decision.question,
      });
    });

    const selections = new Set(completion.recommendations.map(keyOf));

    if (selections.size !== completion.recommendations.length) reject();

    if (
      [...completion.evidence, ...completion.unknowns].some(
        (item) => !selections.has(keyOf(item)),
      )
    ) {
      reject();
    }

    const perNeed = new Map<string, { primary: number; alternative: number }>();

    const recommendations = completion.recommendations.map((selection) => {
      const options = current.get(selection.needId)?.options ?? reject();

      const counts = perNeed.get(selection.needId) ?? {
        primary: 0,
        alternative: 0,
      };

      counts[selection.role] += 1;

      if (counts.primary > 1 || counts.alternative > 2) reject();

      perNeed.set(selection.needId, counts);

      const evidence = completion.evidence.filter(
        (item) => keyOf(item) === keyOf(selection),
      );

      const reasons = (kind: 'reason' | 'tradeoff'): RecommendationReason[] =>
        evidence
          .filter((item) => item.kind === kind)
          .map((item) => {
            const option =
              options.find((value) => value.token === item.referenceToken) ??
              reject();

            if (!option.attributeIds.includes(item.attributeId)) reject();

            return {
              attributeId: item.attributeId,
              text: item.text,
              reference: {
                kind: option.kind,
                id: option.id,
              },
            };
          });

      return core.verifyRecommendation(selection.needId, {
        productId: selection.productId,
        role: selection.role,
        reasons: reasons('reason'),
        tradeoffs: reasons('tradeoff'),
        unknowns: completion.unknowns
          .filter((item) => keyOf(item) === keyOf(selection))
          .map((item) => item.attributeId),
      });
    });

    result = ConsultationAgentResultSchema.parse({
      message: completion.message,
      decisions,
      recommendations,
      ...artifacts,
    });
  } catch (error) {
    if (
      !(error instanceof InvalidCompletion) &&
      !(error instanceof z.ZodError) &&
      !(error instanceof Error && error.message.startsWith('ConsultationCore:'))
    ) {
      throw error;
    }

    result = fallback();
  }

  core.seal();

  return {
    result,
    memories: core.committedMemories(),
  };
}
