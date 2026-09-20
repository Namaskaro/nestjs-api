import { z } from 'zod';

import {
  PendingProductClarificationSchema,
  ProductClarificationFieldSchema,
  ProductReferenceSchema,
} from '@/src/product-consultation/application/context/product-context.schema';

import {
  AgentConsultationMemoryViewSchema,
  AgentPreferenceSchema,
  AgentProductFactsSchema,
  AttributeDefinitionSchema,
  GuidanceRuleSchema,
  QuestionRuleSchema,
  CanonicalRequirementSchema,
  CONSULTATION_SAFETY_LIMITS,
  ProductComparisonSchema,
  ProductDetailsArtifactSchema,
  RecommendationSchema,
} from '@/src/product-consultation/core/consultation-core.schema';

import { ComparisonPresentationSchema } from '@/src/product-consultation/application/presentation/comparison-presentation.schema';

import { ProductDetailsPresentationSchema } from '@/src/product-consultation/application/presentation/product-presentation.schema';

export const ConsultationRefinementFieldSchema =
  ProductClarificationFieldSchema;

export const ConsultationNextActionSchema = z.enum([
  'SHOW_RESULTS',
  'REFINE',
  'SUGGEST_ALTERNATIVES',
]);

export const ConsultationAlternativeStrategySchema = z.enum([
  'RELAX_FILTERS',
  'EXPAND_SEARCH',
]);

export const ConsultationAlternativePlanSchema = z.object({
  strategy: ConsultationAlternativeStrategySchema,

  description: z.string().trim().min(1),
});

export const ConsultationProductSchema = z.object({
  id: z.string().min(1),

  title: z.string(),

  price: z.string(),
});

export const ConsultationSearchContextSchema = z.object({
  needId: z.string().min(1),

  query: z.string().min(1),

  preferences: z.array(AgentPreferenceSchema).max(10),

  profile: z.object({
    id: z.string().min(1),

    version: z.number().int().positive(),

    attributes: z.array(AttributeDefinitionSchema).max(128),

    guidance: z.array(GuidanceRuleSchema).max(8),

    questions: z.array(QuestionRuleSchema).max(4),
  }),

  memory: AgentConsultationMemoryViewSchema,

  memoryRevision: z.number().int().nonnegative(),

  requirements: z.array(CanonicalRequirementSchema).max(32),

  products: z.array(ConsultationProductSchema).max(5),

  comparisonProductIds: z
    .array(z.string().min(1))
    .max(CONSULTATION_SAFETY_LIMITS.comparisonProducts),

  facts: z
    .array(AgentProductFactsSchema)
    .max(CONSULTATION_SAFETY_LIMITS.allowedProductsPerNeed),

  referenceOptions: z
    .array(
      z.object({
        token: z.string().min(1),

        kind: z.enum([
          'criterion',
          'guidance',
          'requirement',
          'goal',
          'preference',
        ]),

        text: z.string(),

        attributeIds: z.array(z.string().min(1)).max(128),
      }),
    )
    .max(256),

  reused: z.boolean(),
});

export const ConsultationAgentInputSchema = z.object({
  query: z.string().min(1),

  displayOrder: z.array(ProductReferenceSchema).max(25),

  pendingClarification: PendingProductClarificationSchema.nullable(),

  searches: z.array(ConsultationSearchContextSchema).min(1).max(5),
});

const ConsultationDecisionBaseSchema = z.object({
  nextAction: ConsultationNextActionSchema,

  suggestedFields: z
    .array(ConsultationRefinementFieldSchema)
    .max(1)
    .default(() => []),

  alternativePlan: ConsultationAlternativePlanSchema.nullable().default(null),

  question: z.string().trim().min(1).nullable().default(null),
});

function validateDecision(
  decision: z.infer<typeof ConsultationDecisionBaseSchema>,
  ctx: z.RefinementCtx,
) {
  const valid =
    decision.nextAction === 'SHOW_RESULTS'
      ? decision.question === null &&
        decision.suggestedFields.length === 0 &&
        decision.alternativePlan === null
      : decision.nextAction === 'REFINE'
      ? decision.question !== null &&
        decision.suggestedFields.length === 1 &&
        decision.alternativePlan === null
      : decision.question !== null &&
        decision.suggestedFields.length === 0 &&
        decision.alternativePlan !== null;

  if (!valid) {
    ctx.addIssue({
      code: 'custom',

      message: 'Несогласованные поля consultation decision.',
    });
  }
}

export const ConsultationDecisionSchema = ConsultationDecisionBaseSchema.extend(
  {
    needId: z.string().min(1),

    query: z.string().min(1),
  },
).superRefine(validateDecision);

export const ConsultationAgentResultSchema = z
  .object({
    message: z.string().trim().min(1),

    decisions: z.array(ConsultationDecisionSchema).min(1).max(5),

    recommendations: z
      .array(RecommendationSchema)
      .max(15)
      .default(() => []),

    productDetails: z
      .array(ProductDetailsArtifactSchema)
      .max(250)
      .default(() => []),

    comparisons: z
      .array(ProductComparisonSchema)
      .max(CONSULTATION_SAFETY_LIMITS.comparisonsPerTurn)
      .default(() => []),

    comparisonPresentation:
      ComparisonPresentationSchema.nullable().default(null),

    productDetailsPresentation:
      ProductDetailsPresentationSchema.nullable().default(null),
  })
  .superRefine(({ decisions }, ctx) => {
    if (decisions.filter((decision) => decision.question !== null).length > 1) {
      ctx.addIssue({
        code: 'custom',

        message: 'Допустим только один вопрос за ответ.',
      });
    }

    if (
      new Set(decisions.map((decision) => decision.needId)).size !==
      decisions.length
    ) {
      ctx.addIssue({
        code: 'custom',

        message: 'Повторяющиеся needId в decisions.',
      });
    }
  });

export type ConsultationAgentInput = z.infer<
  typeof ConsultationAgentInputSchema
>;

export type ConsultationAgentResult = z.infer<
  typeof ConsultationAgentResultSchema
>;
