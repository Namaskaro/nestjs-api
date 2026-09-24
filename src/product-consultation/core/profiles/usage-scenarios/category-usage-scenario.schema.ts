import { z } from 'zod';

import {
  CategoryProfileSchema,
  type CategoryProfile,
} from '../../consultation-core.schema';

const IdSchema = z.string().trim().min(1).max(160);

export const UsageScenarioQuestionSchema = z
  .object({
    when: z.string().trim().min(1),

    question: z.string().trim().min(1),
  })
  .strict();

export const CategoryUsageScenarioSchema = z
  .object({
    /**
     * Stable server-owned ID сценария.
     *
     * Например:
     *
     * daily_walking
     * training
     * wet_weather
     * formal_event
     */
    id: IdSchema,

    /**
     * Читаемое название сценария.
     */
    title: z.string().trim().min(1),

    /**
     * Что означает этот сценарий
     * именно для данной категории.
     */
    description: z.string().trim().min(1),

    /**
     * Примеры пользовательских сигналов.
     *
     * Это НЕ regex и НЕ deterministic parser.
     *
     * Эти фразы позже помогают
     * Product Consultant понять,
     * какой usage scenario релевантен.
     */
    signals: z.array(z.string().trim().min(1)).min(1).max(24),

    /**
     * ProductFact attributes,
     * которые полезны при оценке товара
     * в рамках этого сценария.
     *
     * Они НЕ становятся автоматически
     * hard SearchSpec constraints.
     */
    attributeIds: z.array(IdSchema).min(1).max(16),

    /**
     * Как Consultant должен рассуждать
     * при оценке товаров для сценария.
     *
     * Здесь должны быть:
     *
     * - полезные связи;
     * - ограничения;
     * - запрет на необоснованные выводы.
     */
    instruction: z.string().trim().min(1),

    /**
     * Опциональный follow-up.
     *
     * Задаётся только если уточнение
     * реально способно изменить выбор.
     *
     * Это НЕ обязательный questionnaire.
     */
    question: UsageScenarioQuestionSchema.nullable(),
  })
  .strict();

export const CategoryUsageKnowledgeSchema = z
  .object({
    /**
     * CategoryProfile,
     * к которому относятся знания.
     */
    profileId: IdSchema,

    version: z.number().int().positive(),

    scenarios: z.array(CategoryUsageScenarioSchema).max(32),
  })
  .strict()
  .superRefine((knowledge, context) => {
    const scenarioIds = knowledge.scenarios.map((scenario) => scenario.id);

    if (new Set(scenarioIds).size !== scenarioIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ['scenarios'],

        message: `Category usage knowledge ${knowledge.profileId} содержит duplicate scenario IDs.`,
      });
    }
  });

export type CategoryUsageScenario = z.infer<typeof CategoryUsageScenarioSchema>;

export type CategoryUsageKnowledge = z.infer<
  typeof CategoryUsageKnowledgeSchema
>;

/**
 * Создаёт и валидирует usage knowledge
 * относительно реального CategoryProfile.
 *
 * Это важный deterministic boundary:
 *
 * usage scenario не может ссылаться
 * на attribute, которого категория
 * вообще не знает.
 */
export function defineCategoryUsageKnowledge(
  profileRaw: CategoryProfile,

  knowledgeRaw: unknown,
): CategoryUsageKnowledge {
  const profile = CategoryProfileSchema.parse(profileRaw);

  const knowledge = CategoryUsageKnowledgeSchema.parse(knowledgeRaw);

  if (knowledge.profileId !== profile.id) {
    throw new Error(
      `CategoryUsageKnowledge: profile ${knowledge.profileId} ` +
        `does not match CategoryProfile ${profile.id}.`,
    );
  }

  const knownAttributes = new Set(
    profile.attributes.map((attribute) => attribute.id),
  );

  for (const scenario of knowledge.scenarios) {
    for (const attributeId of scenario.attributeIds) {
      if (!knownAttributes.has(attributeId)) {
        throw new Error(
          `CategoryUsageKnowledge: scenario ${scenario.id} ` +
            `references unknown attribute ${attributeId} ` +
            `for profile ${profile.id}.`,
        );
      }
    }
  }

  return knowledge;
}
