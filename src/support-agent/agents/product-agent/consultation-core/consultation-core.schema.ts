import { z } from 'zod';

export const CONSULTATION_SAFETY_LIMITS = {
  storedGoals: 32,
  storedCriteria: 128,
  storedFeedback: 64,

  profileAttributes: 128,
  profileGuidanceRules: 64,
  profileQuestionRules: 32,

  allowedProductsPerNeed: 100,
  comparisonProducts: 8,

  toolCallsPerTurn: 16,
  comparisonsPerTurn: 4,
} as const;

export const DEFAULT_CONSULTATION_AGENT_BUDGET = {
  visibleGoals: 6,
  visibleCriteria: 12,
  visibleFeedback: 8,

  initialFactProducts: 3,
  initialFactAttributes: 8,

  detailFactAttributes: 16,
  comparisonProducts: 4,

  toolCallsPerTurn: 6,
  comparisonsPerTurn: 2,
} as const;

const IdSchema = z.string().trim().min(1).max(160);

const SourceTextSchema = z.string().trim().min(1).max(500);

const ScalarValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

const FactValueSchema = z.union([
  ScalarValueSchema,
  z.array(z.string()),
  z.null(),
]);

const UnitSchema = z.string().trim().min(1).nullable();

const ImportanceSchema = z.enum(['normal', 'high']);

export const ConsultationOperatorSchema = z.enum([
  'observe',
  'eq',
  'contains',
  'lte',
  'gte',
]);

export const AttributeKindSchema = z.enum(['text', 'number', 'boolean', 'set']);

export const FactStatusSchema = z.enum([
  'known',
  'unknown',
  'not_applicable',
  'conflicting',
]);

export const AttributeComparisonSchema = z.enum([
  'exact',
  'numeric',
  'set',
  'none',
]);

const ALLOWED_OPERATORS_BY_KIND = {
  text: new Set(['observe', 'eq']),
  number: new Set(['observe', 'eq', 'lte', 'gte']),
  boolean: new Set(['observe', 'eq']),
  set: new Set(['observe', 'contains']),
} as const;

const DEFAULT_COMPARISON_BY_KIND = {
  text: 'exact',
  number: 'numeric',
  boolean: 'exact',
  set: 'set',
} as const;

export const AttributeDefinitionSchema = z
  .object({
    id: IdSchema,

    label: z.string().trim().min(1),

    kind: AttributeKindSchema,

    unit: UnitSchema,

    allowedOperators: z.array(ConsultationOperatorSchema).min(1),

    comparison: AttributeComparisonSchema,
  })
  .superRefine((attribute, ctx) => {
    if (
      new Set(attribute.allowedOperators).size !==
      attribute.allowedOperators.length
    ) {
      ctx.addIssue({
        code: 'custom',

        message: `Attribute ${attribute.id} содержит duplicate operators.`,
      });
    }

    const allowedOperators = ALLOWED_OPERATORS_BY_KIND[attribute.kind];

    if (
      attribute.allowedOperators.some(
        (operator) => !allowedOperators.has(operator as never),
      )
    ) {
      ctx.addIssue({
        code: 'custom',

        message:
          `Attribute ${attribute.id} содержит operator, ` +
          `несовместимый с kind=${attribute.kind}.`,
      });
    }

    if (attribute.kind !== 'number' && attribute.unit !== null) {
      ctx.addIssue({
        code: 'custom',

        message: `Unit допустим только для number attribute: ${attribute.id}.`,
      });
    }

    if (
      attribute.comparison !== 'none' &&
      attribute.comparison !== DEFAULT_COMPARISON_BY_KIND[attribute.kind]
    ) {
      ctx.addIssue({
        code: 'custom',

        message: `Attribute ${attribute.id} имеет несовместимый comparison.`,
      });
    }
  });

export const GuidanceRuleSchema = z.object({
  id: IdSchema,

  when: z.string().trim().min(1),

  attributeIds: z.array(IdSchema).min(1).max(16),

  instruction: z.string().trim().min(1),
});

export const QuestionRuleSchema = z.object({
  id: IdSchema,

  when: z.string().trim().min(1),

  attributeIds: z.array(IdSchema).min(1).max(8),

  question: z.string().trim().min(1),
});

export const CategoryProfileSchema = z
  .object({
    id: IdSchema,

    version: z.number().int().positive(),

    attributes: z
      .array(AttributeDefinitionSchema)
      .min(1)
      .max(CONSULTATION_SAFETY_LIMITS.profileAttributes),

    defaultCriteria: z.array(IdSchema).max(32),

    criticalAttributes: z.array(IdSchema).max(32),

    guidance: z
      .array(GuidanceRuleSchema)
      .max(CONSULTATION_SAFETY_LIMITS.profileGuidanceRules),

    questions: z
      .array(QuestionRuleSchema)
      .max(CONSULTATION_SAFETY_LIMITS.profileQuestionRules),

    knowledgeRefs: z
      .array(IdSchema)
      .max(64)
      .default(() => []),
  })
  .superRefine((profile, ctx) => {
    const attributeIds = profile.attributes.map((attribute) => attribute.id);

    const knownAttributes = new Set(attributeIds);

    if (knownAttributes.size !== attributeIds.length) {
      ctx.addIssue({
        code: 'custom',

        message: `CategoryProfile ${profile.id} содержит duplicate attributes.`,
      });
    }

    const referencedAttributes = [
      ...profile.defaultCriteria,

      ...profile.criticalAttributes,

      ...profile.guidance.flatMap((rule) => rule.attributeIds),

      ...profile.questions.flatMap((rule) => rule.attributeIds),
    ];

    if (
      referencedAttributes.some(
        (attributeId) => !knownAttributes.has(attributeId),
      )
    ) {
      ctx.addIssue({
        code: 'custom',

        message:
          `CategoryProfile ${profile.id} ссылается ` +
          `на неизвестный attribute.`,
      });
    }

    const guidanceIds = profile.guidance.map((rule) => rule.id);

    if (new Set(guidanceIds).size !== guidanceIds.length) {
      ctx.addIssue({
        code: 'custom',

        message: `CategoryProfile ${profile.id} содержит duplicate guidance IDs.`,
      });
    }

    const questionIds = profile.questions.map((rule) => rule.id);

    if (new Set(questionIds).size !== questionIds.length) {
      ctx.addIssue({
        code: 'custom',

        message: `CategoryProfile ${profile.id} содержит duplicate question IDs.`,
      });
    }
  });

export const ConsultationGoalDraftSchema = z.object({
  text: z.string().trim().min(1).max(500),

  importance: ImportanceSchema,

  sourceText: SourceTextSchema,
});

export const ConsultationGoalSchema = ConsultationGoalDraftSchema.extend({
  goalId: IdSchema,
});

export const CriterionDraftSchema = z.object({
  attributeId: IdSchema,

  operator: ConsultationOperatorSchema,

  value: ScalarValueSchema.nullable(),

  unit: UnitSchema,

  required: z.boolean(),

  importance: ImportanceSchema,

  sourceText: SourceTextSchema,
});

export const CriterionSchema = CriterionDraftSchema.extend({
  criterionId: IdSchema,
});

export const ProductFeedbackSchema = z.object({
  productId: IdSchema,

  reaction: z.enum(['like', 'dislike', 'mixed']),

  reason: z.string().trim().min(1).max(500).nullable(),

  attributeId: IdSchema.nullable(),

  sourceText: SourceTextSchema,
});

export const ConsultationMemorySchema = z
  .object({
    goals: z
      .array(ConsultationGoalSchema)
      .max(CONSULTATION_SAFETY_LIMITS.storedGoals),

    criteria: z
      .array(CriterionSchema)
      .max(CONSULTATION_SAFETY_LIMITS.storedCriteria),

    feedback: z
      .array(ProductFeedbackSchema)
      .max(CONSULTATION_SAFETY_LIMITS.storedFeedback),
  })
  .superRefine((memory, ctx) => {
    const goalIds = memory.goals.map((goal) => goal.goalId);

    if (new Set(goalIds).size !== goalIds.length) {
      ctx.addIssue({
        code: 'custom',

        message: 'ConsultationMemory содержит duplicate goalId.',
      });
    }

    const criterionIds = memory.criteria.map(
      (criterion) => criterion.criterionId,
    );

    if (new Set(criterionIds).size !== criterionIds.length) {
      ctx.addIssue({
        code: 'custom',

        message: 'ConsultationMemory содержит duplicate criterionId.',
      });
    }

    const feedbackProductIds = memory.feedback.map(
      (feedback) => feedback.productId,
    );

    if (new Set(feedbackProductIds).size !== feedbackProductIds.length) {
      ctx.addIssue({
        code: 'custom',

        message:
          'ConsultationMemory содержит несколько feedback ' +
          'для одного productId.',
      });
    }
  });

export function emptyConsultationMemory(): ConsultationMemory {
  return {
    goals: [],

    criteria: [],

    feedback: [],
  };
}

/**
 * Это уже не вся persistent memory,
 * а компактное представление, которое разрешено дать модели.
 *
 * Конкретный subset выбирает ConsultationCore.
 */
export const AgentConsultationMemoryViewSchema = z.object({
  goals: z.array(ConsultationGoalSchema),

  criteria: z.array(CriterionSchema),

  feedback: z.array(ProductFeedbackSchema),
});

export const ConsultationMemoryPatchSchema = z.object({
  goals: z.object({
    add: z
      .array(ConsultationGoalDraftSchema)
      .max(CONSULTATION_SAFETY_LIMITS.storedGoals),

    update: z
      .array(
        z.object({
          goalId: IdSchema,

          goal: ConsultationGoalDraftSchema,
        }),
      )
      .max(CONSULTATION_SAFETY_LIMITS.storedGoals),

    remove: z
      .array(
        z.object({
          goalId: IdSchema,

          sourceText: SourceTextSchema,
        }),
      )
      .max(CONSULTATION_SAFETY_LIMITS.storedGoals),
  }),

  criteria: z.object({
    add: z
      .array(CriterionDraftSchema)
      .max(CONSULTATION_SAFETY_LIMITS.storedCriteria),

    update: z
      .array(
        z.object({
          criterionId: IdSchema,

          criterion: CriterionDraftSchema,
        }),
      )
      .max(CONSULTATION_SAFETY_LIMITS.storedCriteria),

    remove: z
      .array(
        z.object({
          criterionId: IdSchema,

          sourceText: SourceTextSchema,
        }),
      )
      .max(CONSULTATION_SAFETY_LIMITS.storedCriteria),
  }),

  feedback: z.object({
    upsert: z
      .array(ProductFeedbackSchema)
      .max(CONSULTATION_SAFETY_LIMITS.storedFeedback),

    remove: z
      .array(
        z.object({
          productId: IdSchema,

          sourceText: SourceTextSchema,
        }),
      )
      .max(CONSULTATION_SAFETY_LIMITS.storedFeedback),
  }),
});

export const UpdateConsultationMemoryInputSchema = z.object({
  needId: IdSchema,

  expectedRevision: z.number().int().nonnegative(),

  patch: ConsultationMemoryPatchSchema,
});

export const ProductSourceSchema = z.object({
  sourceId: IdSchema,

  recordId: IdSchema,

  observedAt: z.string().datetime(),

  updatedAt: z.string().datetime().nullable(),
});

export const FactProvenanceSchema = ProductSourceSchema.extend({
  paths: z.array(z.string().min(1)).min(1),

  transformation: z.string().min(1).nullable(),
});

export const ProductFactSchema = z
  .object({
    attributeId: IdSchema,

    kind: AttributeKindSchema,

    unit: UnitSchema,

    status: FactStatusSchema,

    value: FactValueSchema,

    displayValue: z.string().nullable(),

    provenance: z.array(FactProvenanceSchema),
  })
  .superRefine((fact, ctx) => {
    if (fact.status !== 'known') {
      if (fact.value !== null) {
        ctx.addIssue({
          code: 'custom',

          message:
            `ProductFact ${fact.attributeId}: ` +
            'status != known требует value=null.',
        });
      }

      return;
    }

    const validValue =
      (fact.kind === 'text' && typeof fact.value === 'string') ||
      (fact.kind === 'number' && typeof fact.value === 'number') ||
      (fact.kind === 'boolean' && typeof fact.value === 'boolean') ||
      (fact.kind === 'set' && Array.isArray(fact.value));

    if (!validValue) {
      ctx.addIssue({
        code: 'custom',

        message:
          `ProductFact ${fact.attributeId} содержит ` + 'value неверного типа.',
      });
    }

    if (fact.provenance.length === 0) {
      ctx.addIssue({
        code: 'custom',

        message:
          `Known ProductFact ${fact.attributeId} ` + 'должен иметь provenance.',
      });
    }
  });

/**
 * Компактная LLM-проекция ProductFact.
 *
 * Здесь намеренно нет:
 * sourceId, recordId, timestamps, paths и transformation.
 */
export const AgentFactViewSchema = z.object({
  attributeId: IdSchema,

  status: FactStatusSchema,

  value: FactValueSchema,

  unit: UnitSchema,

  displayValue: z.string().nullable(),
});

export const AgentProductFactsSchema = z.object({
  productId: IdSchema,

  title: z.string().nullable(),

  profileId: IdSchema.nullable(),

  found: z.boolean(),

  facts: z
    .array(AgentFactViewSchema)
    .max(CONSULTATION_SAFETY_LIMITS.profileAttributes),
});

export const AgentPreferenceSchema = z.object({
  preferenceId: IdSchema,

  text: z.string().trim().min(1).max(500),
});

const CatalogEntitySchema = z.object({
  id: IdSchema,

  name: z.string(),
});

export const ProductDetailsSchema = z.object({
  id: IdSchema,

  title: z.string(),

  description: z.string(),

  productType: z.string(),

  profileId: IdSchema,

  price: z.string(),

  currency: z.string().nullable(),

  discount: z.string().nullable(),

  images: z.array(z.string()),

  availability: z.object({
    inStock: z.boolean().nullable(),

    stock: z.number().int().nonnegative().nullable(),
  }),

  brand: CatalogEntitySchema.nullable(),

  category: CatalogEntitySchema.nullable(),

  subcategory: CatalogEntitySchema.nullable(),

  attributes: z
    .array(ProductFactSchema)
    .max(CONSULTATION_SAFETY_LIMITS.profileAttributes),

  source: ProductSourceSchema,
});

export const ProductDetailsArtifactSchema = z.object({
  needId: IdSchema,

  product: ProductDetailsSchema,
});

export const CanonicalRequirementSchema = z.object({
  requirementId: IdSchema,

  attributeId: IdSchema,

  operator: z.enum(['eq', 'contains', 'lte', 'gte']),

  value: ScalarValueSchema.nullable(),

  unit: UnitSchema,

  resolution: z.enum(['resolved', 'unresolved']),

  label: z.string().trim().min(1),
});

export const RequirementCheckSchema = z.object({
  requirementId: IdSchema,

  productId: IdSchema,

  attributeId: IdSchema,

  label: z.string(),

  outcome: z.enum(['pass', 'fail', 'unknown']),
});

const ComparisonRowStateSchema = z.enum([
  'same',
  'different',
  'numeric_difference',
  'not_comparable',
  'unknown',
]);

const NumericRangeSchema = z
  .object({
    min: z.number().finite(),

    max: z.number().finite(),

    spread: z.number().finite(),

    unit: UnitSchema,
  })
  .nullable();

export const ProductComparisonSchema = z.object({
  comparisonId: IdSchema,

  needId: IdSchema,

  profileId: IdSchema,

  profileVersion: z.number().int().positive(),

  memoryRevision: z.number().int().nonnegative(),

  productIds: z
    .array(IdSchema)
    .min(2)
    .max(CONSULTATION_SAFETY_LIMITS.comparisonProducts),

  rows: z
    .array(
      z.object({
        attributeId: IdSchema,

        label: z.string(),

        criterionIds: z.array(IdSchema),

        cells: z.array(
          z.object({
            productId: IdSchema,

            fact: ProductFactSchema,
          }),
        ),

        state: ComparisonRowStateSchema,

        range: NumericRangeSchema,
      }),
    )
    .max(CONSULTATION_SAFETY_LIMITS.profileAttributes),

  requirementChecks: z.array(RequirementCheckSchema),

  missingFacts: z.array(
    z.object({
      productId: IdSchema,

      attributeId: IdSchema,

      status: z.enum(['unknown', 'not_applicable', 'conflicting']),
    }),
  ),

  limitations: z.array(z.string()),

  comparedAt: z.string().datetime(),
});

/**
 * Компактная проекция сравнения для LLM.
 *
 * Полный ProductComparison остаётся server-side artifact.
 */
export const AgentComparisonViewSchema = z.object({
  comparisonId: IdSchema,

  needId: IdSchema,

  profileId: IdSchema,

  memoryRevision: z.number().int().nonnegative(),

  productIds: z
    .array(IdSchema)
    .min(2)
    .max(CONSULTATION_SAFETY_LIMITS.comparisonProducts),

  rows: z.array(
    z.object({
      attributeId: IdSchema,

      criterionIds: z.array(IdSchema),

      state: ComparisonRowStateSchema,

      range: NumericRangeSchema,

      cells: z.array(
        z.object({
          productId: IdSchema,

          status: FactStatusSchema,

          value: FactValueSchema,

          unit: UnitSchema,

          displayValue: z.string().nullable(),
        }),
      ),
    }),
  ),

  requirementChecks: z.array(
    z.object({
      requirementId: IdSchema,

      productId: IdSchema,

      outcome: z.enum(['pass', 'fail', 'unknown']),
    }),
  ),

  limitations: z.array(z.string()),
});

export const RecommendationReferenceSchema = z.object({
  kind: z.enum(['criterion', 'guidance', 'requirement', 'goal', 'preference']),

  id: IdSchema,
});

export const RecommendationReasonSchema = z.object({
  attributeId: IdSchema,

  reference: RecommendationReferenceSchema,

  text: z.string().trim().min(1).max(500),
});

const VerifiedRecommendationReasonSchema = RecommendationReasonSchema.extend({
  referenceText: z.string(),

  fact: ProductFactSchema,
});

export const RecommendationPayloadSchema = z.object({
  productId: IdSchema,

  role: z.enum(['primary', 'alternative']),

  reasons: z.array(RecommendationReasonSchema).min(1).max(6),

  tradeoffs: z.array(RecommendationReasonSchema).max(6),

  unknowns: z.array(IdSchema).max(32),
});

export const RecommendationSchema = RecommendationPayloadSchema.extend({
  needId: IdSchema,

  profileId: IdSchema,

  profileVersion: z.number().int().positive(),

  reasons: z.array(VerifiedRecommendationReasonSchema).min(1).max(6),

  tradeoffs: z.array(VerifiedRecommendationReasonSchema).max(6),
});

export const GetProductDetailsInputSchema = z.object({
  needId: IdSchema,

  productIds: z.array(IdSchema).min(1).max(8),

  attributeIds: z.array(IdSchema).min(1).max(32).nullable(),

  presentation: z.enum(['facts', 'details']),
});

export const CompareProductsInputSchema = z.object({
  needId: IdSchema,

  expectedRevision: z.number().int().nonnegative(),

  productIds: z
    .array(IdSchema)
    .min(2)
    .max(CONSULTATION_SAFETY_LIMITS.comparisonProducts),

  attributeIds: z.array(IdSchema).min(1).max(32).nullable(),
});

export type AttributeDefinition = z.infer<typeof AttributeDefinitionSchema>;

export type CategoryProfile = z.infer<typeof CategoryProfileSchema>;

export type ConsultationGoalDraft = z.infer<typeof ConsultationGoalDraftSchema>;

export type ConsultationGoal = z.infer<typeof ConsultationGoalSchema>;

export type CriterionDraft = z.infer<typeof CriterionDraftSchema>;

export type Criterion = z.infer<typeof CriterionSchema>;

export type ProductFeedback = z.infer<typeof ProductFeedbackSchema>;

export type ConsultationMemory = z.infer<typeof ConsultationMemorySchema>;

export type AgentConsultationMemoryView = z.infer<
  typeof AgentConsultationMemoryViewSchema
>;

export type ProductFact = z.infer<typeof ProductFactSchema>;

export type AgentFactView = z.infer<typeof AgentFactViewSchema>;

export type AgentPreference = z.infer<typeof AgentPreferenceSchema>;

export type ProductDetails = z.infer<typeof ProductDetailsSchema>;

export type CanonicalRequirement = z.infer<typeof CanonicalRequirementSchema>;

export type ProductComparison = z.infer<typeof ProductComparisonSchema>;

export type AgentComparisonView = z.infer<typeof AgentComparisonViewSchema>;

export type RecommendationPayload = z.infer<typeof RecommendationPayloadSchema>;

export type RecommendationReason = z.infer<typeof RecommendationReasonSchema>;
