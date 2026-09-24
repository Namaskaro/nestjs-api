import { z } from 'zod';

const IdSchema = z.string().trim().min(1).max(160);

const SourceTextSchema = z.string().trim().min(1).max(500);

const ImportanceSchema = z.enum(['normal', 'high']);

const PreferenceOperatorSchema = z.enum(['eq', 'contains', 'lte', 'gte']);

const PreferenceValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

/**
 * Пользователь сообщил цель текущей покупки.
 *
 * Здесь намеренно НЕТ goalId.
 */
const RememberGoalObservationSchema = z
  .object({
    kind: z.literal('goal'),

    operation: z.literal('remember'),

    text: z.string().trim().min(1).max(500),

    importance: ImportanceSchema,

    sourceText: SourceTextSchema,
  })
  .strict();

/**
 * Пользователь явно сообщил,
 * что ранее известная цель
 * больше не относится к текущей задаче.
 *
 * Backend сам найдёт goalId.
 */
const ForgetGoalObservationSchema = z
  .object({
    kind: z.literal('goal'),

    operation: z.literal('forget'),

    text: z.string().trim().min(1).max(500),

    sourceText: SourceTextSchema,
  })
  .strict();

/**
 * Мягкое предпочтение.
 *
 * Например:
 *
 * "желательно полегче"
 *
 * Это НЕ hard SearchSpec constraint.
 *
 * required здесь отсутствует намеренно.
 * Backend всегда создаёт такой criterion
 * с required=false.
 */
const RememberCriterionObservationSchema = z
  .object({
    kind: z.literal('criterion'),

    operation: z.literal('remember'),

    attributeId: IdSchema,

    operator: PreferenceOperatorSchema,

    value: PreferenceValueSchema,

    unit: z.string().trim().min(1).nullable(),

    importance: ImportanceSchema,

    sourceText: SourceTextSchema,
  })
  .strict();

/**
 * Пользователь больше не считает
 * мягкое предпочтение актуальным.
 *
 * Никакого criterionId от модели.
 */
const ForgetCriterionObservationSchema = z
  .object({
    kind: z.literal('criterion'),

    operation: z.literal('forget'),

    attributeId: IdSchema,

    operator: PreferenceOperatorSchema,

    sourceText: SourceTextSchema,
  })
  .strict();

export const ConsultationMemoryObservationSchema = z.discriminatedUnion(
  'kind',
  [
    z.discriminatedUnion('operation', [
      RememberGoalObservationSchema,
      ForgetGoalObservationSchema,
    ]),

    z.discriminatedUnion('operation', [
      RememberCriterionObservationSchema,
      ForgetCriterionObservationSchema,
    ]),
  ],
);

/**
 * За один turn одна semantic memory slot
 * изменяется максимум один раз.
 *
 * Например, нельзя одновременно:
 *
 * remember price:lte
 * forget   price:lte
 *
 * Если пользователь изменил значение,
 * достаточно одного remember:
 * backend сам сделает update.
 */
export const ConsultationMemoryObservationsSchema = z
  .array(ConsultationMemoryObservationSchema)
  .max(16)
  .superRefine((observations, context) => {
    const seen = new Set<string>();

    observations.forEach((observation, index) => {
      const key =
        observation.kind === 'goal'
          ? ['goal', observation.text.trim().toLocaleLowerCase()].join(':')
          : ['criterion', observation.attributeId, observation.operator].join(
              ':',
            );

      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',

          path: [index],

          message: `Duplicate memory observation target: ${key}`,
        });

        return;
      }

      seen.add(key);
    });
  });

export type ConsultationMemoryObservation = z.infer<
  typeof ConsultationMemoryObservationSchema
>;

export type ConsultationMemoryObservations = z.infer<
  typeof ConsultationMemoryObservationsSchema
>;
