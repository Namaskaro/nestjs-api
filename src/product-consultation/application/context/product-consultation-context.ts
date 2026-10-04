import { z } from 'zod';

import {
  AgentComparisonViewSchema,
  AgentFactViewSchema,
  ConsultationGoalSchema,
  CriterionSchema,
  DEFAULT_CONSULTATION_AGENT_BUDGET,
  GuidanceRuleSchema,
  ProductDetailsSchema,
  ProductFeedbackSchema,
  QuestionRuleSchema,
  type AgentComparisonView,
  type ProductDetails,
  type ProductFact,
} from '../../core/consultation-core.schema';

import { CATEGORY_PROFILES } from '../../core/profiles';

import {
  CategoryUsageScenarioSchema,
  MAX_SELECTED_USAGE_SCENARIOS,
  resolveCategoryUsageScenarioSelection,
} from '../../core/profiles/usage-scenarios';

import type { SearchResultSnapshot } from '../../core/results/consultation-results.schema';

import { SearchSpecSchema } from '../../core/search/search-spec.schema';

import {
  ProductSearchCapabilitiesSchema,
  type ProductSearchCapabilities,
} from '../search/product-search-capabilities';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../runtime/consultation-application-record';

const MAX_RECENT_MESSAGES = 6;

const MAX_CONTEXT_FACT_PRODUCTS = 5;

const MAX_CONTEXT_FACT_ATTRIBUTES = 16;

const MAX_DESCRIPTION_LENGTH = 6000;

const MODEL_HIDDEN_FACT_ATTRIBUTES = new Set(['inStock', 'stock']);

const MODEL_DISPLAY_VALUE_ATTRIBUTES = new Set([
  'brand',
  'category',
  'subcategory',
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const ContextMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),

    text: z.string().trim().min(1).max(4000),
  })
  .strict();

const ContextGoalSchema = ConsultationGoalSchema.omit({
  goalId: true,
}).strict();

const ContextCriterionSchema = CriterionSchema.omit({
  criterionId: true,
  required: true,
}).strict();

const ContextFeedbackSchema = ProductFeedbackSchema.omit({
  productId: true,
})
  .extend({
    position: z.number().int().positive(),
  })
  .strict();

const ContextMemorySchema = z
  .object({
    goals: z
      .array(ContextGoalSchema)
      .max(DEFAULT_CONSULTATION_AGENT_BUDGET.visibleGoals),

    criteria: z
      .array(ContextCriterionSchema)
      .max(DEFAULT_CONSULTATION_AGENT_BUDGET.visibleCriteria),

    feedback: z
      .array(ContextFeedbackSchema)
      .max(DEFAULT_CONSULTATION_AGENT_BUDGET.visibleFeedback),
  })
  .strict();

const ContextTaskSchema = z
  .object({
    search: SearchSpecSchema.nullable(),

    memory: ContextMemorySchema,
  })
  .strict();

const ContextShownProductSchema = z
  .object({
    position: z.number().int().positive(),

    title: z.string(),

    price: z.string(),

    image: z.string().nullable(),
  })
  .strict();

const ContextProductFactsSchema = z
  .object({
    position: z.number().int().positive(),

    title: z.string(),

    description: z.string().max(MAX_DESCRIPTION_LENGTH),

    profileId: z.string().trim().min(1),

    facts: z.array(AgentFactViewSchema).max(MAX_CONTEXT_FACT_ATTRIBUTES),
  })
  .strict();

const ContextSemanticEvidenceSchema = z
  .object({
    position: z.number().int().positive(),

    summary: z.string().min(1).max(400),

    targetAudience: z.array(z.string().min(1).max(120)).max(4),

    styleAssociations: z.array(z.string().min(1).max(80)).max(5),

    useCases: z.array(z.string().min(1).max(120)).max(5),

    pricePositioning: z.string().min(1).max(120),
  })
  .strict();

const ContextProfileSchema = z
  .object({
    id: z.string().trim().min(1),

    version: z.number().int().positive(),

    guidance: z.array(GuidanceRuleSchema),

    questions: z.array(QuestionRuleSchema),
  })
  .strict();

const ContextUsageScenarioIndexItemSchema = z
  .object({
    id: z.string().trim().min(1),

    title: z.string().trim().min(1),

    description: z.string().trim().min(1),

    signals: z.array(z.string().trim().min(1)).min(1).max(24),
  })
  .strict();

const ContextUsageKnowledgeSchema = z
  .object({
    profileId: z.string().trim().min(1),

    version: z.number().int().positive(),

    available: z.array(ContextUsageScenarioIndexItemSchema).max(32),

    selected: z
      .array(CategoryUsageScenarioSchema)
      .max(MAX_SELECTED_USAGE_SCENARIOS),
  })
  .strict();

const ContextSearchCapabilityAttributeSchema = z
  .object({
    attributeId: z.string().trim().min(1),

    kind: z.enum(['text', 'number', 'boolean', 'set']),

    unit: z.string().trim().min(1).nullable(),

    operators: z
      .array(z.enum(['eq', 'contains', 'lte', 'gte']))
      .min(1)
      .max(4),
  })
  .strict();

const ContextSearchCapabilityProfileSchema = z
  .object({
    profileId: z.string().trim().min(1),

    attributes: z.array(ContextSearchCapabilityAttributeSchema).max(64),
  })
  .strict();

const ContextSearchCapabilitiesSchema = z
  .object({
    profiles: z.array(ContextSearchCapabilityProfileSchema).max(32),

    maxConstraints: z.number().int().positive().nullable(),
  })
  .strict();

const ContextComparisonCellSchema = z
  .object({
    position: z.number().int().positive(),

    status: z.enum(['known', 'unknown', 'not_applicable', 'conflicting']),

    value: z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.array(z.string()),
      z.null(),
    ]),

    unit: z.string().trim().min(1).nullable(),

    displayValue: z.string().nullable(),
  })
  .strict();

const ContextComparisonRowSchema = z
  .object({
    attributeId: z.string().trim().min(1),

    state: z.enum([
      'same',
      'different',
      'numeric_difference',
      'not_comparable',
      'unknown',
    ]),

    range: z
      .object({
        min: z.number().finite(),

        max: z.number().finite(),

        spread: z.number().finite(),

        unit: z.string().trim().min(1).nullable(),
      })
      .nullable(),

    cells: z.array(ContextComparisonCellSchema),
  })
  .strict();

const ContextComparisonSchema = z
  .object({
    rows: z.array(ContextComparisonRowSchema),

    limitations: z.array(z.string()),
  })
  .strict();

export const ProductConsultationLlmContextSchema = z
  .object({
    version: z.literal(1),

    currentMessage: z.string().trim().min(1).max(4000),

    recentMessages: z.array(ContextMessageSchema).max(MAX_RECENT_MESSAGES),

    task: ContextTaskSchema.nullable(),

    searchCapabilities: ContextSearchCapabilitiesSchema.nullable(),

    results: z
      .object({
        status: z.enum(['idle', 'pending', 'active', 'failure']),

        hasLastConfirmed: z.boolean(),

        shownProducts: z.array(ContextShownProductSchema).max(25),
      })
      .strict(),

    productFacts: z
      .array(ContextProductFactsSchema)
      .max(MAX_CONTEXT_FACT_PRODUCTS),

    semanticEvidence: z
      .array(ContextSemanticEvidenceSchema)
      .max(MAX_CONTEXT_FACT_PRODUCTS),

    comparison: ContextComparisonSchema.nullable(),

    profile: ContextProfileSchema.nullable(),

    usage: ContextUsageKnowledgeSchema.nullable(),
  })
  .strict();

export type ProductConsultationLlmContext = z.infer<
  typeof ProductConsultationLlmContextSchema
>;

export type ProductConsultationContextMessage = z.infer<
  typeof ContextMessageSchema
>;

export type ProductSemanticEvidenceSource = {
  summary: string;

  targetAudience: readonly string[];

  styleAssociations: readonly string[];

  useCases: readonly string[];

  pricePositioning: string;
};

export type BuildProductConsultationContextInput = {
  record: ConsultationApplicationRecord;

  currentMessage: string;

  recentMessages?: readonly ProductConsultationContextMessage[];

  referenceResultId?: string | null;

  selectedProducts?: readonly ProductDetails[];

  semanticRepresentations?: ReadonlyMap<string, ProductSemanticEvidenceSource>;

  factAttributeIds?: readonly string[] | null;

  comparison?: AgentComparisonView | null;

  usageScenarioIds?: readonly string[];

  searchCapabilities?: ProductSearchCapabilities | null;
};

export type BuiltProductConsultationContext = {
  expectedRevision: number;

  expectedResultId: string | null;

  context: ProductConsultationLlmContext;
};

type ModelFactValue = string | number | boolean | string[] | null;

function semanticDisplayValue(displayValue: string | null): string | null {
  if (displayValue === null) {
    return null;
  }

  const normalized = displayValue.trim();

  if (!normalized || UUID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function modelSafeFactValue(input: {
  attributeId: string;

  status: 'known' | 'unknown' | 'not_applicable' | 'conflicting';

  value: ModelFactValue;

  displayValue: string | null;
}): {
  safe: boolean;

  value: ModelFactValue;
} {
  if (input.status !== 'known') {
    return {
      safe: true,

      value: input.value,
    };
  }

  const displayValue = semanticDisplayValue(input.displayValue);

  if (
    MODEL_DISPLAY_VALUE_ATTRIBUTES.has(input.attributeId) &&
    displayValue !== null
  ) {
    return {
      safe: true,

      value: displayValue,
    };
  }

  if (typeof input.value === 'string' && UUID_PATTERN.test(input.value)) {
    if (displayValue !== null) {
      return {
        safe: true,

        value: displayValue,
      };
    }

    return {
      safe: false,

      value: null,
    };
  }

  if (
    Array.isArray(input.value) &&
    input.value.some((value) => UUID_PATTERN.test(value))
  ) {
    return {
      safe: false,

      value: null,
    };
  }

  return {
    safe: true,

    value: input.value,
  };
}

function visibleMemory(
  record: ConsultationApplicationRecord,

  snapshot: SearchResultSnapshot | null,
) {
  const memory = record.state?.memory.memory;

  if (!memory) {
    return {
      goals: [],

      criteria: [],

      feedback: [],
    };
  }

  const positionByProductId = new Map(
    (snapshot?.products ?? []).map(
      (product, index) => [product.productId, index + 1] as const,
    ),
  );

  return {
    goals: memory.goals
      .slice(0, DEFAULT_CONSULTATION_AGENT_BUDGET.visibleGoals)
      .map((goal) => ({
        text: goal.text,

        importance: goal.importance,

        sourceText: goal.sourceText,
      })),

    criteria: memory.criteria
      .slice(0, DEFAULT_CONSULTATION_AGENT_BUDGET.visibleCriteria)
      .map((criterion) => ({
        attributeId: criterion.attributeId,

        operator: criterion.operator,

        value: criterion.value,

        unit: criterion.unit,

        importance: criterion.importance,

        sourceText: criterion.sourceText,
      })),

    feedback: memory.feedback
      .flatMap((feedback) => {
        const position = positionByProductId.get(feedback.productId);

        if (position === undefined) {
          return [];
        }

        return [
          {
            position,

            reaction: feedback.reaction,

            reason: feedback.reason,

            attributeId: feedback.attributeId,

            sourceText: feedback.sourceText,
          },
        ];
      })
      .slice(0, DEFAULT_CONSULTATION_AGENT_BUDGET.visibleFeedback),
  };
}

function resultStatus(
  record: ConsultationApplicationRecord,
): 'idle' | 'pending' | 'active' | 'failure' {
  if (record.results.pendingSearch !== null) {
    return 'pending';
  }

  if (record.results.lastFailure !== undefined) {
    return 'failure';
  }

  if (record.results.active !== null) {
    return 'active';
  }

  return 'idle';
}

function resolveReferenceSnapshot(
  record: ConsultationApplicationRecord,

  requestedResultId: string | null | undefined,
): {
  resultId: string | null;

  snapshot: SearchResultSnapshot | null;
} {
  const resultId =
    requestedResultId === undefined
      ? record.results.active?.resultId ?? null
      : requestedResultId;

  if (resultId === null) {
    return {
      resultId: null,

      snapshot: null,
    };
  }

  if (record.results.active?.resultId === resultId) {
    return {
      resultId,

      snapshot: record.results.active,
    };
  }

  if (record.results.lastConfirmed?.resultId === resultId) {
    return {
      resultId,

      snapshot: record.results.lastConfirmed,
    };
  }

  throw new Error(
    `ProductConsultationContext: result snapshot ${resultId} is not available.`,
  );
}

function resolveProfile(record: ConsultationApplicationRecord) {
  const category = record.state?.search?.category ?? null;

  if (category === null) {
    return null;
  }

  const profile =
    CATEGORY_PROFILES.find((candidate) => candidate.id === category) ?? null;

  if (profile === null) {
    throw new Error(
      `ProductConsultationContext: profile ${category} is not registered.`,
    );
  }

  return profile;
}

function resolveUsageContext(
  profileId: string | null,

  rawScenarioIds: readonly string[],
) {
  const resolved = resolveCategoryUsageScenarioSelection(
    profileId,
    rawScenarioIds,
  );

  if (resolved.knowledge === null) {
    return null;
  }

  return {
    profileId: resolved.knowledge.profileId,

    version: resolved.knowledge.version,

    available: resolved.knowledge.scenarios.map((scenario) => ({
      id: scenario.id,

      title: scenario.title,

      description: scenario.description,

      signals: [...scenario.signals],
    })),

    selected: resolved.selected,
  };
}

function searchCapabilitiesContext(
  rawCapabilities: ProductSearchCapabilities | null,
) {
  if (rawCapabilities === null) {
    return null;
  }

  const capabilities = ProductSearchCapabilitiesSchema.parse(rawCapabilities);

  const capabilityByAttribute = new Map(
    capabilities.constraints
      .filter((capability) => capability.modelVisible)
      .map((capability) => [capability.attributeId, capability] as const),
  );

  const profiles = capabilities.profileIds.flatMap((profileId) => {
    const profile =
      CATEGORY_PROFILES.find((candidate) => candidate.id === profileId) ?? null;

    if (profile === null) {
      return [];
    }

    const attributes = profile.attributes.flatMap((attribute) => {
      const capability = capabilityByAttribute.get(attribute.id);

      if (!capability) {
        return [];
      }

      const operators = capability.operators.filter((operator) =>
        attribute.allowedOperators.includes(operator),
      );

      if (operators.length === 0) {
        return [];
      }

      return [
        {
          attributeId: attribute.id,

          kind: attribute.kind,

          unit: attribute.unit,

          operators,
        },
      ];
    });

    return [
      {
        profileId: profile.id,

        attributes,
      },
    ];
  });

  return {
    profiles,

    maxConstraints: capabilities.maxConstraints,
  };
}

function orderedCandidateFacts(
  product: ProductDetails,

  attributeIds: readonly string[] | null,
): ProductFact[] {
  if (attributeIds === null) {
    return product.attributes;
  }

  const factByAttribute = new Map(
    product.attributes.map((fact) => [fact.attributeId, fact] as const),
  );

  return [...new Set(attributeIds)].flatMap((attributeId) => {
    const fact = factByAttribute.get(attributeId);

    return fact ? [fact] : [];
  });
}

function selectedFacts(input: {
  products: readonly ProductDetails[];

  snapshot: SearchResultSnapshot | null;

  attributeIds: readonly string[] | null;
}) {
  if (input.products.length > MAX_CONTEXT_FACT_PRODUCTS) {
    throw new Error(
      `ProductConsultationContext: at most ${MAX_CONTEXT_FACT_PRODUCTS} fact products are allowed.`,
    );
  }

  if (input.products.length > 0 && input.snapshot === null) {
    throw new Error(
      'ProductConsultationContext: product facts require a bound result snapshot.',
    );
  }

  const positionByProductId = new Map(
    (input.snapshot?.products ?? []).map(
      (product, index) => [product.productId, index + 1] as const,
    ),
  );

  return input.products.map((productRaw) => {
    const product = ProductDetailsSchema.parse(productRaw);

    const position = positionByProductId.get(product.id);

    if (position === undefined) {
      throw new Error(
        `ProductConsultationContext: product ${product.id} does not belong to the bound result snapshot.`,
      );
    }

    const facts = orderedCandidateFacts(product, input.attributeIds)
      .filter((fact) => !MODEL_HIDDEN_FACT_ATTRIBUTES.has(fact.attributeId))
      .flatMap((fact) => {
        const projected = modelSafeFactValue({
          attributeId: fact.attributeId,

          status: fact.status,

          value: fact.value,

          displayValue: fact.displayValue,
        });

        if (!projected.safe) {
          return [];
        }

        return [
          AgentFactViewSchema.parse({
            attributeId: fact.attributeId,

            status: fact.status,

            value: projected.value,

            unit: fact.unit,

            displayValue: fact.displayValue,
          }),
        ];
      })
      .slice(0, MAX_CONTEXT_FACT_ATTRIBUTES);

    return {
      position,

      title: product.title,

      description: product.description.slice(0, MAX_DESCRIPTION_LENGTH),

      profileId: product.profileId,

      facts,
    };
  });
}

function selectedSemanticEvidence(input: {
  products: readonly ProductDetails[];

  snapshot: SearchResultSnapshot | null;

  representations: ReadonlyMap<string, ProductSemanticEvidenceSource>;
}) {
  if (input.products.length === 0 || input.representations.size === 0) {
    return [];
  }

  if (input.snapshot === null) {
    throw new Error(
      'ProductConsultationContext: semantic evidence requires a bound result snapshot.',
    );
  }

  const positionByProductId = new Map(
    input.snapshot.products.map(
      (product, index) => [product.productId, index + 1] as const,
    ),
  );

  return input.products.flatMap((product) => {
    const position = positionByProductId.get(product.id);

    if (position === undefined) {
      throw new Error(
        `ProductConsultationContext: product ${product.id} does not belong to the bound result snapshot.`,
      );
    }

    const representation = input.representations.get(product.id);

    if (!representation) {
      return [];
    }

    return [
      {
        position,

        summary: representation.summary,

        targetAudience: [...representation.targetAudience],

        styleAssociations: [...representation.styleAssociations],

        useCases: [...representation.useCases],

        pricePositioning: representation.pricePositioning,
      },
    ];
  });
}

function comparisonContext(input: {
  comparison: AgentComparisonView | null;

  snapshot: SearchResultSnapshot | null;
}) {
  if (input.comparison === null) {
    return null;
  }

  if (input.snapshot === null) {
    throw new Error(
      'ProductConsultationContext: comparison requires a bound result snapshot.',
    );
  }

  const comparison = AgentComparisonViewSchema.parse(input.comparison);

  const positionByProductId = new Map(
    input.snapshot.products.map(
      (product, index) => [product.productId, index + 1] as const,
    ),
  );

  for (const productId of comparison.productIds) {
    if (!positionByProductId.has(productId)) {
      throw new Error(
        `ProductConsultationContext: comparison product ${productId} does not belong to the bound result snapshot.`,
      );
    }
  }

  const rows = comparison.rows.flatMap((row) => {
    if (MODEL_HIDDEN_FACT_ATTRIBUTES.has(row.attributeId)) {
      return [];
    }

    const projectedCells = [];

    for (const cell of row.cells) {
      const position = positionByProductId.get(cell.productId);

      if (position === undefined) {
        throw new Error(
          `ProductConsultationContext: comparison product ${cell.productId} does not belong to the bound result snapshot.`,
        );
      }

      const projected = modelSafeFactValue({
        attributeId: row.attributeId,

        status: cell.status,

        value: cell.value,

        displayValue: cell.displayValue,
      });

      if (!projected.safe) {
        return [];
      }

      projectedCells.push({
        position,

        status: cell.status,

        value: projected.value,

        unit: cell.unit,

        displayValue: cell.displayValue,
      });
    }

    return [
      {
        attributeId: row.attributeId,

        state: row.state,

        range: row.range,

        cells: projectedCells,
      },
    ];
  });

  return {
    rows,

    limitations: [...comparison.limitations],
  };
}

export function buildProductConsultationContext(
  input: BuildProductConsultationContextInput,
): BuiltProductConsultationContext {
  const record = ConsultationApplicationRecordSchema.parse(input.record);

  const { resultId, snapshot } = resolveReferenceSnapshot(
    record,
    input.referenceResultId,
  );

  const profile = resolveProfile(record);

  const recentMessages = (input.recentMessages ?? [])
    .map((message) => ContextMessageSchema.parse(message))
    .slice(-MAX_RECENT_MESSAGES);

  const usage = resolveUsageContext(
    profile?.id ?? null,
    input.usageScenarioIds ?? [],
  );

  const selectedProducts = input.selectedProducts ?? [];

  const context = ProductConsultationLlmContextSchema.parse({
    version: 1,

    currentMessage: input.currentMessage,

    recentMessages,

    task:
      record.state === null
        ? null
        : {
            search: record.state.search,

            memory: visibleMemory(record, snapshot),
          },

    searchCapabilities: searchCapabilitiesContext(
      input.searchCapabilities ?? null,
    ),

    results: {
      status: resultStatus(record),

      hasLastConfirmed: record.results.lastConfirmed !== null,

      shownProducts: (snapshot?.products ?? []).map((product, index) => ({
        position: index + 1,

        title: product.title,

        price: product.price,

        image: product.image,
      })),
    },

    productFacts: selectedFacts({
      products: selectedProducts,

      snapshot,

      attributeIds: input.factAttributeIds ?? null,
    }),

    semanticEvidence: selectedSemanticEvidence({
      products: selectedProducts,

      snapshot,

      representations: input.semanticRepresentations ?? new Map(),
    }),

    comparison: comparisonContext({
      comparison: input.comparison ?? null,

      snapshot,
    }),

    profile:
      profile === null
        ? null
        : {
            id: profile.id,

            version: profile.version,

            guidance: profile.guidance,

            questions: profile.questions,
          },

    usage,
  });

  return {
    expectedRevision: record.revision,

    expectedResultId: resultId,

    context,
  };
}
