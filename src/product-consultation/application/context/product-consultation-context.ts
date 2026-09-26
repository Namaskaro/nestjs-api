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
} from '../../core/consultation-core.schema';

import { CATEGORY_PROFILES } from '../../core/profiles';

import {
  CategoryUsageScenarioSchema,
  getCategoryUsageKnowledge,
} from '../../core/profiles/usage-scenarios';

import type { SearchResultSnapshot } from '../../core/results/consultation-results.schema';

import { SearchSpecSchema } from '../../core/search/search-spec.schema';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../runtime/consultation-application-record';

const MAX_RECENT_MESSAGES = 6;

const MAX_CONTEXT_FACT_PRODUCTS = 5;

const MAX_CONTEXT_FACT_ATTRIBUTES = 16;

const MAX_SELECTED_USAGE_SCENARIOS = 3;

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

    profileId: z.string().trim().min(1),

    facts: z.array(AgentFactViewSchema).max(MAX_CONTEXT_FACT_ATTRIBUTES),
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

/**
 * LLM projection deterministic comparison.
 *
 * ВАЖНО:
 *
 * здесь нет:
 *
 * - comparisonId;
 * - needId;
 * - memoryRevision;
 * - productId;
 * - criterionId;
 * - requirementId.
 *
 * Вместо productId Consultant
 * получает position относительно
 * server-bound snapshot.
 */
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

    /**
     * Ephemeral deterministic
     * comparison текущего round.
     *
     * Не persisted state.
     */
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

export type BuildProductConsultationContextInput = {
  record: ConsultationApplicationRecord;

  currentMessage: string;

  recentMessages?: readonly ProductConsultationContextMessage[];

  referenceResultId?: string | null;

  selectedProducts?: readonly ProductDetails[];

  factAttributeIds?: readonly string[] | null;

  /**
   * Deterministic comparison,
   * вычисленный backend capability.
   */
  comparison?: AgentComparisonView | null;

  usageScenarioIds?: readonly string[];
};

export type BuiltProductConsultationContext = {
  expectedRevision: number;

  expectedResultId: string | null;

  context: ProductConsultationLlmContext;
};

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
      (
        product,

        index,
      ) => [product.productId, index + 1],
    ),
  );

  return {
    goals: memory.goals
      .slice(
        0,

        DEFAULT_CONSULTATION_AGENT_BUDGET.visibleGoals,
      )
      .map((goal) => ({
        text: goal.text,

        importance: goal.importance,

        sourceText: goal.sourceText,
      })),

    criteria: memory.criteria
      .slice(
        0,

        DEFAULT_CONSULTATION_AGENT_BUDGET.visibleCriteria,
      )
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
      .slice(
        0,

        DEFAULT_CONSULTATION_AGENT_BUDGET.visibleFeedback,
      ),
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
  const scenarioIds = rawScenarioIds.map((scenarioId) => scenarioId.trim());

  if (scenarioIds.some((scenarioId) => !scenarioId)) {
    throw new Error(
      'ProductConsultationContext: usage scenario ID must not be empty.',
    );
  }

  if (scenarioIds.length > MAX_SELECTED_USAGE_SCENARIOS) {
    throw new Error(
      `ProductConsultationContext: at most ${MAX_SELECTED_USAGE_SCENARIOS} usage scenarios may be selected.`,
    );
  }

  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error('ProductConsultationContext: duplicate usage scenario ID.');
  }

  if (profileId === null) {
    if (scenarioIds.length > 0) {
      throw new Error(
        'ProductConsultationContext: usage scenario requires an active category profile.',
      );
    }

    return null;
  }

  const knowledge = getCategoryUsageKnowledge(profileId);

  if (knowledge === null) {
    if (scenarioIds.length > 0) {
      throw new Error(
        `ProductConsultationContext: profile ${profileId} has no registered usage scenarios.`,
      );
    }

    return null;
  }

  const scenarioById = new Map(
    knowledge.scenarios.map((scenario) => [scenario.id, scenario]),
  );

  const selected = scenarioIds.map((scenarioId) => {
    const scenario = scenarioById.get(scenarioId);

    if (!scenario) {
      throw new Error(
        `ProductConsultationContext: usage scenario ${scenarioId} is not registered for profile ${profileId}.`,
      );
    }

    return scenario;
  });

  return {
    profileId: knowledge.profileId,

    version: knowledge.version,

    available: knowledge.scenarios.map((scenario) => ({
      id: scenario.id,

      title: scenario.title,

      description: scenario.description,

      signals: [...scenario.signals],
    })),

    selected,
  };
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
      (
        product,

        index,
      ) => [product.productId, index + 1],
    ),
  );

  const requestedAttributes =
    input.attributeIds === null ? null : new Set(input.attributeIds);

  return input.products.map((productRaw) => {
    const product = ProductDetailsSchema.parse(productRaw);

    const position = positionByProductId.get(product.id);

    if (position === undefined) {
      throw new Error(
        `ProductConsultationContext: product ${product.id} does not belong to the bound result snapshot.`,
      );
    }

    const facts = product.attributes
      .filter(
        (fact) =>
          requestedAttributes === null ||
          requestedAttributes.has(fact.attributeId),
      )
      .slice(
        0,

        MAX_CONTEXT_FACT_ATTRIBUTES,
      )
      .map((fact) =>
        AgentFactViewSchema.parse({
          attributeId: fact.attributeId,

          status: fact.status,

          value: fact.value,

          unit: fact.unit,

          displayValue: fact.displayValue,
        }),
      );

    return {
      position,

      title: product.title,

      profileId: product.profileId,

      facts,
    };
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
      (
        product,

        index,
      ) => [product.productId, index + 1],
    ),
  );

  for (const productId of comparison.productIds) {
    if (!positionByProductId.has(productId)) {
      throw new Error(
        `ProductConsultationContext: comparison product ${productId} does not belong to the bound result snapshot.`,
      );
    }
  }

  return {
    rows: comparison.rows.map((row) => ({
      attributeId: row.attributeId,

      state: row.state,

      range: row.range,

      cells: row.cells.map((cell) => {
        const position = positionByProductId.get(cell.productId);

        if (position === undefined) {
          throw new Error(
            `ProductConsultationContext: comparison product ${cell.productId} does not belong to the bound result snapshot.`,
          );
        }

        return {
          position,

          status: cell.status,

          value: cell.value,

          unit: cell.unit,

          displayValue: cell.displayValue,
        };
      }),
    })),

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

  const context = ProductConsultationLlmContextSchema.parse({
    version: 1,

    currentMessage: input.currentMessage,

    recentMessages,

    task:
      record.state === null
        ? null
        : {
            search: record.state.search,

            memory: visibleMemory(
              record,

              snapshot,
            ),
          },

    results: {
      status: resultStatus(record),

      hasLastConfirmed: record.results.lastConfirmed !== null,

      shownProducts: (snapshot?.products ?? []).map(
        (
          product,

          index,
        ) => ({
          position: index + 1,

          title: product.title,

          price: product.price,

          image: product.image,
        }),
      ),
    },

    productFacts: selectedFacts({
      products: input.selectedProducts ?? [],

      snapshot,

      attributeIds: input.factAttributeIds ?? null,
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
