import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AgentComparisonViewSchema,
  AgentConsultationMemoryViewSchema,
  AgentProductFactsSchema,
  CanonicalRequirementSchema,
  CategoryProfileSchema,
  CompareProductsInputSchema,
  ConsultationMemorySchema,
  CriterionDraftSchema,
  DEFAULT_CONSULTATION_AGENT_BUDGET,
  GetProductDetailsInputSchema,
  ProductComparisonSchema,
  ProductDetailsArtifactSchema,
  ProductDetailsSchema,
  ProductFactSchema,
  RecommendationPayloadSchema,
  RecommendationSchema,
  UpdateConsultationMemoryInputSchema,
  type AgentComparisonView,
  type AgentConsultationMemoryView,
  type AgentFactView,
  type AgentPreference,
  type AttributeDefinition,
  type CanonicalRequirement,
  type CategoryProfile,
  type ConsultationMemory,
  type CriterionDraft,
  type ProductDetails,
  type ProductFact,
  type ProductFeedback,
  type RecommendationReason,
} from './consultation-core.schema';

type AgentProductFacts = z.infer<typeof AgentProductFactsSchema>;
type VerifiedRecommendation = z.infer<typeof RecommendationSchema>;

export type ConsultationNeedSnapshot = {
  needId: string;
  query: string;
  preferences: string[];
  profileId: string;
  memory: ConsultationMemory;
  requirements: CanonicalRequirement[];
  allowedProductIds: string[];
  displayedProductIds: string[];
  comparisonProductIds: string[];
};

export type ConsultationAgentBudget = {
  visibleGoals: number;
  visibleCriteria: number;
  visibleFeedback: number;
  initialFactProducts: number;
  initialFactAttributes: number;
  detailFactAttributes: number;
  comparisonProducts: number;
  toolCallsPerTurn: number;
  comparisonsPerTurn: number;
};

export type AgentCategoryProfileView = {
  id: string;
  version: number;
  attributes: AttributeDefinition[];
  guidance: CategoryProfile['guidance'];
  questions: CategoryProfile['questions'];
};

export type ConsultationInitialView = {
  needId: string;
  query: string;
  memoryRevision: number;
  preferences: AgentPreference[];
  memory: AgentConsultationMemoryView;
  profile: AgentCategoryProfileView;
  displayedProductIds: string[];
  comparisonProductIds: string[];
  products: AgentProductFacts[];
};

export type ConsultationReferenceOption = {
  token: string;
  kind: RecommendationReason['reference']['kind'];
  id: string;
  text: string;
  attributeIds: string[];
};

export type ConsultationReferenceOptions = {
  needId: string;
  memoryRevision: number;
  options: ConsultationReferenceOption[];
};

export type ConsultationCoreInput = {
  needs: ConsultationNeedSnapshot[];
  products: ProductDetails[];
  profiles: CategoryProfile[];
  budget?: Partial<ConsultationAgentBudget>;
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function equalityKey(value: ProductFact['value']): string {
  return JSON.stringify(
    Array.isArray(value) ? [...new Set(value)].sort() : value,
  );
}

function attributeSignature(definition: AttributeDefinition): string {
  return JSON.stringify({
    kind: definition.kind,
    unit: definition.unit,
    comparison: definition.comparison,
    allowedOperators: [...definition.allowedOperators].sort(),
  });
}

function prioritized<T>(
  values: readonly T[],
  limit: number,
  isPriority: (value: T) => boolean,
): T[] {
  const important = values.filter(isPriority);
  const rest = values.filter((value) => !isPriority(value));
  return [...important, ...rest].slice(0, limit);
}

function assertDistinct(values: readonly string[], label: string): void {
  if (unique(values).length !== values.length) {
    throw new Error(`ConsultationCore: duplicate ${label}`);
  }
}

function validateBudget(
  input: Partial<ConsultationAgentBudget> | undefined,
): ConsultationAgentBudget {
  const budget: ConsultationAgentBudget = {
    ...DEFAULT_CONSULTATION_AGENT_BUDGET,
    ...input,
  };

  for (const [key, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`ConsultationCore: invalid budget ${key}`);
    }
  }

  return budget;
}

export class ConsultationCore {
  private readonly needs = new Map<string, ConsultationNeedSnapshot>();
  private readonly products = new Map<string, ProductDetails>();
  private readonly profiles = new Map<string, CategoryProfile>();
  private readonly definitions = new Map<string, AttributeDefinition>();
  private readonly revisions = new Map<string, number>();
  private readonly exposedFacts = new Map<string, Set<string>>();
  private readonly detailArtifacts = new Map<
    string,
    z.infer<typeof ProductDetailsArtifactSchema>
  >();
  private readonly comparisons: z.infer<typeof ProductComparisonSchema>[] = [];
  private readonly budget: ConsultationAgentBudget;
  private toolCalls = 0;
  private comparisonCalls = 0;
  private sealed = false;

  public constructor(input: ConsultationCoreInput) {
    this.budget = validateBudget(input.budget);

    for (const rawProfile of input.profiles) {
      const profile = CategoryProfileSchema.parse(rawProfile);

      if (this.profiles.has(profile.id)) {
        throw new Error(`ConsultationCore: duplicate profile ${profile.id}`);
      }

      this.profiles.set(profile.id, profile);

      for (const definition of profile.attributes) {
        const previous = this.definitions.get(definition.id);

        if (
          previous &&
          attributeSignature(previous) !== attributeSignature(definition)
        ) {
          throw new Error(
            `ConsultationCore: incompatible canonical attribute ${definition.id}`,
          );
        }

        this.definitions.set(definition.id, definition);
      }
    }

    for (const rawProduct of input.products) {
      const product = ProductDetailsSchema.parse(rawProduct);

      if (this.products.has(product.id)) {
        throw new Error(`ConsultationCore: duplicate product ${product.id}`);
      }

      this.products.set(product.id, product);
    }

    for (const rawNeed of input.needs) {
      if (this.needs.has(rawNeed.needId)) {
        throw new Error(`ConsultationCore: duplicate need ${rawNeed.needId}`);
      }

      if (!this.profiles.has(rawNeed.profileId)) {
        throw new Error(
          `ConsultationCore: unknown profile ${rawNeed.profileId}`,
        );
      }

      assertDistinct(
        rawNeed.allowedProductIds,
        `allowed product in ${rawNeed.needId}`,
      );
      assertDistinct(
        rawNeed.displayedProductIds,
        `displayed product in ${rawNeed.needId}`,
      );
      assertDistinct(
        rawNeed.comparisonProductIds,
        `comparison product in ${rawNeed.needId}`,
      );

      const allowed = new Set(rawNeed.allowedProductIds);

      for (const productId of [
        ...rawNeed.displayedProductIds,
        ...rawNeed.comparisonProductIds,
      ]) {
        if (!allowed.has(productId)) {
          throw new Error(
            `ConsultationCore: unauthorized visible product ${productId}`,
          );
        }
      }

      const requirements = rawNeed.requirements.map((requirement) =>
        CanonicalRequirementSchema.parse(requirement),
      );

      for (const requirement of requirements) {
        if (!this.definitions.has(requirement.attributeId)) {
          throw new Error(
            `ConsultationCore: unknown requirement attribute ${requirement.attributeId}`,
          );
        }
      }

      const need: ConsultationNeedSnapshot = {
        ...structuredClone(rawNeed),
        memory: ConsultationMemorySchema.parse(rawNeed.memory),
        requirements,
      };

      this.needs.set(need.needId, need);
      this.revisions.set(need.needId, 0);
    }
  }

  private open(): void {
    if (this.sealed) {
      throw new Error('ConsultationCore: consultation already sealed');
    }
  }

  private registerToolCall(): void {
    this.open();
    this.toolCalls += 1;

    if (this.toolCalls > this.budget.toolCallsPerTurn) {
      throw new Error('ConsultationCore: tool-call budget exceeded');
    }
  }

  private need(needId: string): ConsultationNeedSnapshot {
    const need = this.needs.get(needId);

    if (!need) {
      throw new Error(`ConsultationCore: unknown needId ${needId}`);
    }

    return need;
  }

  private profile(need: ConsultationNeedSnapshot): CategoryProfile {
    const profile = this.profiles.get(need.profileId);

    if (!profile) {
      throw new Error(`ConsultationCore: unknown profile ${need.profileId}`);
    }

    return profile;
  }

  private profileDefinition(
    need: ConsultationNeedSnapshot,
    attributeId: string,
  ): AttributeDefinition | null {
    return (
      this.profile(need).attributes.find(
        (definition) => definition.id === attributeId,
      ) ?? null
    );
  }

  private consultationDefinition(
    need: ConsultationNeedSnapshot,
    attributeId: string,
  ): AttributeDefinition | null {
    const profileDefinition = this.profileDefinition(need, attributeId);

    if (profileDefinition) return profileDefinition;

    const usedByRequirement = need.requirements.some(
      (requirement) => requirement.attributeId === attributeId,
    );

    if (!usedByRequirement) return null;

    return this.definitions.get(attributeId) ?? null;
  }

  private assertConsultationAttribute(
    need: ConsultationNeedSnapshot,
    attributeId: string,
  ): AttributeDefinition {
    const definition = this.consultationDefinition(need, attributeId);

    if (!definition) {
      throw new Error(
        `ConsultationCore: attribute ${attributeId} is outside need profile ${need.profileId}`,
      );
    }

    return definition;
  }

  private assertProfileAttribute(
    need: ConsultationNeedSnapshot,
    attributeId: string,
  ): AttributeDefinition {
    const definition = this.profileDefinition(need, attributeId);

    if (!definition) {
      throw new Error(
        `ConsultationCore: attribute ${attributeId} is not part of profile ${need.profileId}`,
      );
    }

    return definition;
  }

  private revision(needId: string): number {
    return this.revisions.get(needId) ?? 0;
  }

  private authorized(
    need: ConsultationNeedSnapshot,
    productId: string,
  ): boolean {
    return need.allowedProductIds.includes(productId);
  }

  private assertAuthorizedProduct(
    need: ConsultationNeedSnapshot,
    productId: string,
  ): void {
    if (!this.authorized(need, productId)) {
      throw new Error(`ConsultationCore: unauthorized product ${productId}`);
    }
  }

  private loadedProduct(productId: string): ProductDetails | null {
    return this.products.get(productId) ?? null;
  }

  private assertLoadedProduct(
    need: ConsultationNeedSnapshot,
    productId: string,
  ): ProductDetails {
    this.assertAuthorizedProduct(need, productId);
    const product = this.loadedProduct(productId);

    if (!product) {
      throw new Error(`ConsultationCore: product ${productId} is not loaded`);
    }

    return product;
  }

  private fact(
    product: ProductDetails,
    definition: AttributeDefinition,
  ): ProductFact {
    const fact = product.attributes.find(
      (item) => item.attributeId === definition.id,
    );

    if (fact) {
      const parsed = ProductFactSchema.parse(fact);

      if (parsed.kind !== definition.kind || parsed.unit !== definition.unit) {
        throw new Error('CatalogAdapter: incompatible fact ' + definition.id);
      }

      return parsed;
    }

    return ProductFactSchema.parse({
      attributeId: definition.id,
      kind: definition.kind,
      unit: definition.unit,
      status: 'unknown',
      value: null,
      displayValue: null,
      provenance: [],
    });
  }

  private exposureKey(needId: string, productId: string): string {
    return `${needId}:${productId}`;
  }

  private expose(
    needId: string,
    productId: string,
    attributeIds: readonly string[],
  ): void {
    const key = this.exposureKey(needId, productId);
    const set = this.exposedFacts.get(key) ?? new Set<string>();

    for (const attributeId of attributeIds) set.add(attributeId);

    this.exposedFacts.set(key, set);
  }

  private isExposed(
    needId: string,
    productId: string,
    attributeId: string,
  ): boolean {
    return (
      this.exposedFacts
        .get(this.exposureKey(needId, productId))
        ?.has(attributeId) ?? false
    );
  }

  private preferences(need: ConsultationNeedSnapshot): AgentPreference[] {
    return unique(
      need.preferences.map((value) => value.trim()).filter(Boolean),
    ).map((text, index) => ({
      preferenceId: `${need.needId}:preference:${index + 1}`,
      text,
    }));
  }

  private agentMemory(
    need: ConsultationNeedSnapshot,
  ): AgentConsultationMemoryView {
    const goals = prioritized(
      need.memory.goals,
      this.budget.visibleGoals,
      (goal) => goal.importance === 'high',
    );

    const criteria = prioritized(
      need.memory.criteria,
      this.budget.visibleCriteria,
      (criterion) => criterion.required || criterion.importance === 'high',
    );

    const feedback = need.memory.feedback.slice(0, this.budget.visibleFeedback);

    return AgentConsultationMemoryViewSchema.parse({
      goals,
      criteria,
      feedback,
    });
  }

  private relevantAttributeIds(
    need: ConsultationNeedSnapshot,
    limit: number,
  ): string[] {
    const memory = this.agentMemory(need);
    const profile = this.profile(need);

    const ids = unique([
      ...need.requirements.map((requirement) => requirement.attributeId),
      ...memory.criteria.map((criterion) => criterion.attributeId),
      ...memory.feedback.flatMap((feedback) =>
        feedback.attributeId ? [feedback.attributeId] : [],
      ),
      ...profile.criticalAttributes,
      ...profile.defaultCriteria,
    ]);

    return ids
      .filter(
        (attributeId) =>
          this.consultationDefinition(need, attributeId) !== null,
      )
      .slice(0, limit);
  }

  private agentProfile(
    need: ConsultationNeedSnapshot,
    relevantAttributeIds: readonly string[],
  ): AgentCategoryProfileView {
    const profile = this.profile(need);
    const memory = this.agentMemory(need);

    const visibleAttributeIds = new Set(
      unique([
        ...relevantAttributeIds,
        ...memory.criteria.map((criterion) => criterion.attributeId),
      ]),
    );

    const attributes = [...visibleAttributeIds]
      .flatMap((attributeId) => {
        const definition = this.consultationDefinition(need, attributeId);
        return definition ? [definition] : [];
      })
      .slice(
        0,
        Math.max(
          this.budget.initialFactAttributes,
          this.budget.visibleCriteria,
        ),
      );

    const profileAttributeIds = new Set(
      attributes.map((attribute) => attribute.id),
    );

    const guidance = profile.guidance
      .filter((rule) =>
        rule.attributeIds.some((attributeId) =>
          profileAttributeIds.has(attributeId),
        ),
      )
      .slice(0, 8);

    const questions = profile.questions
      .filter((rule) =>
        rule.attributeIds.some((attributeId) =>
          profileAttributeIds.has(attributeId),
        ),
      )
      .slice(0, 4);

    return {
      id: profile.id,
      version: profile.version,
      attributes,
      guidance,
      questions,
    };
  }

  private agentProductFacts(
    need: ConsultationNeedSnapshot,
    productId: string,
    attributeIds: readonly string[],
  ): AgentProductFacts {
    this.assertAuthorizedProduct(need, productId);
    const product = this.loadedProduct(productId);

    if (!product) {
      return AgentProductFactsSchema.parse({
        productId,
        title: null,
        profileId: null,
        found: false,
        facts: [],
      });
    }

    const facts: AgentFactView[] = attributeIds.map((attributeId) => {
      const definition = this.assertConsultationAttribute(need, attributeId);
      const fact = this.fact(product, definition);

      return {
        attributeId: fact.attributeId,
        status: fact.status,
        value: fact.value,
        unit: fact.unit,
        displayValue: fact.displayValue,
      };
    });

    this.expose(need.needId, productId, attributeIds);

    return AgentProductFactsSchema.parse({
      productId,
      title: product.title,
      profileId: product.profileId,
      found: true,
      facts,
    });
  }

  public initialView(needId: string): ConsultationInitialView {
    this.open();
    const need = this.need(needId);

    const attributeIds = this.relevantAttributeIds(
      need,
      this.budget.initialFactAttributes,
    );

    const productIds = unique([
      ...need.comparisonProductIds,
      ...need.displayedProductIds,
      ...need.allowedProductIds,
    ])
      .filter((productId) => this.authorized(need, productId))
      .slice(0, this.budget.initialFactProducts);

    return {
      needId: need.needId,
      query: need.query,
      memoryRevision: this.revision(need.needId),
      preferences: this.preferences(need),
      memory: this.agentMemory(need),
      profile: this.agentProfile(need, attributeIds),
      displayedProductIds: [...need.displayedProductIds],
      comparisonProductIds: [...need.comparisonProductIds],
      products: productIds.map((productId) =>
        this.agentProductFacts(need, productId, attributeIds),
      ),
    };
  }

  public referenceOptions(needId: string): ConsultationReferenceOptions {
    this.open();
    const need = this.need(needId);
    const memoryRevision = this.revision(needId);
    const memory = this.agentMemory(need);

    const profile = this.agentProfile(
      need,
      this.relevantAttributeIds(need, this.budget.initialFactAttributes),
    );

    const profileAttributeIds = profile.attributes
      .map((attribute) => attribute.id)
      .filter((id) => this.profileDefinition(need, id) !== null);

    const candidates: Array<Omit<ConsultationReferenceOption, 'token'>> = [];

    const add = (
      kind: ConsultationReferenceOption['kind'],
      id: string,
      text: string,
      attributeIds: readonly string[],
    ) => {
      if (attributeIds.length) {
        candidates.push({
          kind,
          id,
          text,
          attributeIds: unique(attributeIds),
        });
      }
    };

    for (const item of need.requirements) {
      add('requirement', item.requirementId, item.label, [item.attributeId]);
    }

    for (const item of memory.criteria) {
      if (this.profileDefinition(need, item.attributeId)) {
        add('criterion', item.criterionId, item.sourceText, [item.attributeId]);
      }
    }

    for (const item of profile.guidance) {
      add(
        'guidance',
        item.id,
        item.instruction,
        item.attributeIds.filter((id) => profileAttributeIds.includes(id)),
      );
    }

    for (const item of memory.goals) {
      add('goal', item.goalId, item.text, profileAttributeIds);
    }

    for (const item of this.preferences(need)) {
      add('preference', item.preferenceId, item.text, profileAttributeIds);
    }

    return {
      needId,
      memoryRevision,
      options: candidates.map((item, index) => ({
        token: 'r:' + memoryRevision + ':' + (index + 1),
        ...item,
      })),
    };
  }

  private validateCriterion(
    need: ConsultationNeedSnapshot,
    raw: CriterionDraft,
  ): CriterionDraft {
    const criterion = CriterionDraftSchema.parse(raw);
    const definition = this.assertProfileAttribute(need, criterion.attributeId);

    if (!definition.allowedOperators.includes(criterion.operator)) {
      throw new Error(
        `ConsultationCore: operator ${criterion.operator} is not allowed for ${criterion.attributeId}`,
      );
    }

    if (criterion.operator === 'observe') {
      if (criterion.required) {
        throw new Error(
          'ConsultationCore: observe criterion cannot be required',
        );
      }

      if (criterion.value !== null) {
        throw new Error(
          `ConsultationCore: observe criterion ${criterion.attributeId} must not contain value`,
        );
      }

      return { ...criterion, unit: null };
    }

    if (definition.kind === 'number') {
      if (
        typeof criterion.value !== 'number' ||
        !Number.isFinite(criterion.value) ||
        criterion.unit !== definition.unit
      ) {
        throw new Error(
          `ConsultationCore: invalid numeric criterion ${criterion.attributeId}`,
        );
      }

      return criterion;
    }

    if (criterion.unit !== null) {
      throw new Error(
        `ConsultationCore: non-number criterion ${criterion.attributeId} must not contain unit`,
      );
    }

    if (definition.kind === 'boolean' && typeof criterion.value !== 'boolean') {
      throw new Error(
        `ConsultationCore: invalid boolean criterion ${criterion.attributeId}`,
      );
    }

    if (definition.kind === 'text' && typeof criterion.value !== 'string') {
      throw new Error(
        `ConsultationCore: invalid text criterion ${criterion.attributeId}`,
      );
    }

    if (
      definition.kind === 'set' &&
      (criterion.operator !== 'contains' || typeof criterion.value !== 'string')
    ) {
      throw new Error(
        `ConsultationCore: invalid set criterion ${criterion.attributeId}`,
      );
    }

    return criterion;
  }

  private validateFeedback(
    need: ConsultationNeedSnapshot,
    feedback: ProductFeedback,
  ): ProductFeedback {
    this.assertAuthorizedProduct(need, feedback.productId);

    if (feedback.attributeId !== null) {
      this.assertProfileAttribute(need, feedback.attributeId);
    }

    return feedback;
  }

  public assertMemoryRevision(needId: string, expectedRevision: number): void {
    this.open();
    const need = this.need(needId);
    const currentRevision = this.revision(need.needId);

    if (currentRevision !== expectedRevision) {
      throw new Error(
        `ConsultationCore: stale memory revision for ${need.needId}`,
      );
    }
  }

  public updateMemory(input: unknown): {
    needId: string;
    memoryRevision: number;
    memory: AgentConsultationMemoryView;
  } {
    this.registerToolCall();

    const command = UpdateConsultationMemoryInputSchema.parse(input);
    const need = this.need(command.needId);
    const currentRevision = this.revision(need.needId);

    if (command.expectedRevision !== currentRevision) {
      throw new Error(
        `ConsultationCore: stale memory revision for ${need.needId}`,
      );
    }

    const next = structuredClone(need.memory);

    const goalUpdateIds = command.patch.goals.update.map((item) => item.goalId);
    const goalRemoveIds = command.patch.goals.remove.map((item) => item.goalId);

    assertDistinct(goalUpdateIds, 'goal update id');
    assertDistinct(goalRemoveIds, 'goal remove id');

    if (goalUpdateIds.some((id) => goalRemoveIds.includes(id))) {
      throw new Error(
        'ConsultationCore: goal cannot be updated and removed in one patch',
      );
    }

    for (const item of command.patch.goals.update) {
      const index = next.goals.findIndex((goal) => goal.goalId === item.goalId);

      if (index < 0) {
        throw new Error(`ConsultationCore: unknown goalId ${item.goalId}`);
      }

      next.goals[index] = { goalId: item.goalId, ...item.goal };
    }

    for (const item of command.patch.goals.remove) {
      const index = next.goals.findIndex((goal) => goal.goalId === item.goalId);

      if (index < 0) {
        throw new Error(`ConsultationCore: unknown goalId ${item.goalId}`);
      }

      next.goals.splice(index, 1);
    }

    for (const draft of command.patch.goals.add) {
      next.goals.push({ goalId: randomUUID(), ...draft });
    }

    const criterionUpdateIds = command.patch.criteria.update.map(
      (item) => item.criterionId,
    );
    const criterionRemoveIds = command.patch.criteria.remove.map(
      (item) => item.criterionId,
    );

    assertDistinct(criterionUpdateIds, 'criterion update id');
    assertDistinct(criterionRemoveIds, 'criterion remove id');

    if (criterionUpdateIds.some((id) => criterionRemoveIds.includes(id))) {
      throw new Error(
        'ConsultationCore: criterion cannot be updated and removed in one patch',
      );
    }

    for (const item of command.patch.criteria.update) {
      const index = next.criteria.findIndex(
        (criterion) => criterion.criterionId === item.criterionId,
      );

      if (index < 0) {
        throw new Error(
          `ConsultationCore: unknown criterionId ${item.criterionId}`,
        );
      }

      next.criteria[index] = {
        criterionId: item.criterionId,
        ...this.validateCriterion(need, item.criterion),
      };
    }

    for (const item of command.patch.criteria.remove) {
      const index = next.criteria.findIndex(
        (criterion) => criterion.criterionId === item.criterionId,
      );

      if (index < 0) {
        throw new Error(
          `ConsultationCore: unknown criterionId ${item.criterionId}`,
        );
      }

      next.criteria.splice(index, 1);
    }

    for (const raw of command.patch.criteria.add) {
      const draft = this.validateCriterion(need, raw);
      next.criteria.push({ criterionId: randomUUID(), ...draft });
    }

    const feedbackUpsertIds = command.patch.feedback.upsert.map(
      (item) => item.productId,
    );
    const feedbackRemoveIds = command.patch.feedback.remove.map(
      (item) => item.productId,
    );

    assertDistinct(feedbackUpsertIds, 'feedback upsert product');
    assertDistinct(feedbackRemoveIds, 'feedback remove product');

    if (feedbackUpsertIds.some((id) => feedbackRemoveIds.includes(id))) {
      throw new Error(
        'ConsultationCore: feedback cannot be upserted and removed in one patch',
      );
    }

    for (const removal of command.patch.feedback.remove) {
      const index = next.feedback.findIndex(
        (feedback) => feedback.productId === removal.productId,
      );

      if (index < 0) {
        throw new Error(
          `ConsultationCore: unknown feedback product ${removal.productId}`,
        );
      }

      next.feedback.splice(index, 1);
    }

    for (const raw of command.patch.feedback.upsert) {
      const feedback = this.validateFeedback(need, raw);
      const index = next.feedback.findIndex(
        (item) => item.productId === feedback.productId,
      );

      if (index < 0) next.feedback.push(feedback);
      else next.feedback[index] = feedback;
    }

    need.memory = ConsultationMemorySchema.parse(next);

    const nextRevision = currentRevision + 1;
    this.revisions.set(need.needId, nextRevision);

    return {
      needId: need.needId,
      memoryRevision: nextRevision,
      memory: this.agentMemory(need),
    };
  }

  public getProductDetails(input: unknown): {
    needId: string;
    products: AgentProductFacts[];
  } {
    this.registerToolCall();
    const command = GetProductDetailsInputSchema.parse(input);
    const need = this.need(command.needId);

    assertDistinct(command.productIds, 'details product');

    const attributeIds = command.attributeIds
      ? unique(command.attributeIds)
      : this.relevantAttributeIds(need, this.budget.detailFactAttributes);

    for (const attributeId of attributeIds) {
      this.assertConsultationAttribute(need, attributeId);
    }

    const products = command.productIds.map((productId) => {
      this.assertAuthorizedProduct(need, productId);
      const product = this.loadedProduct(productId);

      if (product && command.presentation === 'details') {
        const artifact = ProductDetailsArtifactSchema.parse({
          needId: need.needId,
          product,
        });

        this.detailArtifacts.set(`${need.needId}:${productId}`, artifact);
      }

      return this.agentProductFacts(need, productId, attributeIds);
    });

    return { needId: need.needId, products };
  }

  private requirements(need: ConsultationNeedSnapshot): CanonicalRequirement[] {
    const requiredCriteria = need.memory.criteria
      .filter((item) => item.required)
      .map((stored): CanonicalRequirement => {
        const criterion = this.validateCriterion(need, stored);

        if (criterion.operator === 'observe') {
          throw new Error(
            'ConsultationCore: required criterion cannot use observe',
          );
        }

        return {
          requirementId: stored.criterionId,
          attributeId: criterion.attributeId,
          operator: criterion.operator,
          value: criterion.value,
          unit: criterion.unit,
          resolution: 'resolved',
          label: criterion.sourceText,
        };
      });

    return [...need.requirements, ...requiredCriteria];
  }

  private checkRequirement(
    need: ConsultationNeedSnapshot,
    product: ProductDetails,
    requirement: CanonicalRequirement,
  ): z.infer<typeof ProductComparisonSchema>['requirementChecks'][number] {
    if (requirement.resolution === 'unresolved') {
      return {
        requirementId: requirement.requirementId,
        productId: product.id,
        attributeId: requirement.attributeId,
        label: requirement.label,
        outcome: 'unknown',
      };
    }

    const definition = this.definitions.get(requirement.attributeId);

    if (!definition) {
      throw new Error(
        `ConsultationCore: unknown requirement definition ${requirement.attributeId}`,
      );
    }

    const fact = this.fact(product, definition);

    if (fact.status !== 'known') {
      return {
        requirementId: requirement.requirementId,
        productId: product.id,
        attributeId: requirement.attributeId,
        label: requirement.label,
        outcome: 'unknown',
      };
    }

    let passed = false;

    if (requirement.operator === 'eq') {
      passed = equalityKey(fact.value) === equalityKey(requirement.value);
    } else if (requirement.operator === 'contains') {
      passed =
        Array.isArray(fact.value) &&
        typeof requirement.value === 'string' &&
        fact.value.includes(requirement.value);
    } else if (
      requirement.operator === 'lte' ||
      requirement.operator === 'gte'
    ) {
      if (
        typeof fact.value === 'number' &&
        typeof requirement.value === 'number'
      ) {
        passed =
          requirement.operator === 'lte'
            ? fact.value <= requirement.value
            : fact.value >= requirement.value;
      }
    }

    return {
      requirementId: requirement.requirementId,
      productId: product.id,
      attributeId: requirement.attributeId,
      label: requirement.label,
      outcome: passed ? 'pass' : 'fail',
    };
  }

  private comparisonState(
    definition: AttributeDefinition,
    facts: readonly ProductFact[],
  ): {
    state: z.infer<typeof ProductComparisonSchema>['rows'][number]['state'];
    range: z.infer<typeof ProductComparisonSchema>['rows'][number]['range'];
  } {
    if (definition.comparison === 'none') {
      return { state: 'not_comparable', range: null };
    }

    if (facts.every((fact) => fact.status === 'not_applicable')) {
      return { state: 'not_comparable', range: null };
    }

    if (facts.some((fact) => fact.status !== 'known')) {
      return { state: 'unknown', range: null };
    }

    if (definition.comparison === 'numeric') {
      const values = facts.map((fact) => fact.value);

      if (values.some((value) => typeof value !== 'number')) {
        return { state: 'not_comparable', range: null };
      }

      const numbers = values as number[];
      const min = Math.min(...numbers);
      const max = Math.max(...numbers);

      return {
        state: min === max ? 'same' : 'numeric_difference',
        range: {
          min,
          max,
          spread: max - min,
          unit: definition.unit,
        },
      };
    }

    const values = new Set(facts.map((fact) => equalityKey(fact.value)));

    return {
      state: values.size === 1 ? 'same' : 'different',
      range: null,
    };
  }

  public compareProducts(input: unknown): AgentComparisonView {
    this.registerToolCall();
    this.comparisonCalls += 1;

    if (this.comparisonCalls > this.budget.comparisonsPerTurn) {
      throw new Error('ConsultationCore: comparison budget exceeded');
    }

    const command = CompareProductsInputSchema.parse(input);
    const need = this.need(command.needId);

    if (command.expectedRevision !== this.revision(need.needId)) {
      throw new Error(
        `ConsultationCore: stale comparison revision for ${need.needId}`,
      );
    }

    assertDistinct(command.productIds, 'comparison product');

    if (command.productIds.length > this.budget.comparisonProducts) {
      throw new Error(
        'ConsultationCore: too many comparison products for current agent budget',
      );
    }

    const products = command.productIds.map((productId) =>
      this.assertLoadedProduct(need, productId),
    );

    const attributeIds = command.attributeIds
      ? unique(command.attributeIds)
      : this.relevantAttributeIds(need, this.budget.detailFactAttributes);

    const definitions = attributeIds.map((attributeId) =>
      this.assertConsultationAttribute(need, attributeId),
    );

    const rows = definitions.map((definition) => {
      const facts = products.map((product) => this.fact(product, definition));

      const { state, range } = this.comparisonState(definition, facts);

      const criterionIds = need.memory.criteria
        .filter((criterion) => criterion.attributeId === definition.id)
        .map((criterion) => criterion.criterionId);

      return {
        attributeId: definition.id,
        label: definition.label,
        criterionIds,
        cells: products.map((product, index) => ({
          productId: product.id,
          fact: facts[index],
        })),
        state,
        range,
      };
    });

    for (const product of products) {
      this.expose(need.needId, product.id, attributeIds);
    }

    const requirementChecks = products.flatMap((product) =>
      this.requirements(need).map((requirement) =>
        this.checkRequirement(need, product, requirement),
      ),
    );

    const missingFacts = rows.flatMap((row) =>
      row.cells.flatMap((cell) =>
        cell.fact.status === 'known'
          ? []
          : [
              {
                productId: cell.productId,
                attributeId: row.attributeId,
                status: cell.fact.status,
              },
            ],
      ),
    );

    const limitations = unique([
      ...need.requirements
        .filter((requirement) => requirement.resolution === 'unresolved')
        .map(
          (requirement) =>
            `Нельзя подтвердить requirement: ${requirement.label}`,
        ),
      ...rows
        .filter(
          (row) => row.state === 'unknown' || row.state === 'not_comparable',
        )
        .map((row) => `Неполное сравнение: ${row.label}`),
    ]).slice(0, 8);

    const comparison = ProductComparisonSchema.parse({
      comparisonId: randomUUID(),
      needId: need.needId,
      profileId: need.profileId,
      profileVersion: this.profile(need).version,
      memoryRevision: this.revision(need.needId),
      productIds: products.map((product) => product.id),
      rows,
      requirementChecks,
      missingFacts,
      limitations,
      comparedAt: new Date().toISOString(),
    });

    this.comparisons.push(comparison);

    return AgentComparisonViewSchema.parse({
      comparisonId: comparison.comparisonId,
      needId: comparison.needId,
      profileId: comparison.profileId,
      memoryRevision: comparison.memoryRevision,
      productIds: comparison.productIds,
      rows: comparison.rows.map((row) => ({
        attributeId: row.attributeId,
        criterionIds: row.criterionIds,
        state: row.state,
        range: row.range,
        cells: row.cells.map((cell) => ({
          productId: cell.productId,
          status: cell.fact.status,
          value: cell.fact.value,
          unit: cell.fact.unit,
          displayValue: cell.fact.displayValue,
        })),
      })),
      requirementChecks: comparison.requirementChecks.map((check) => ({
        requirementId: check.requirementId,
        productId: check.productId,
        outcome: check.outcome,
      })),
      limitations: comparison.limitations,
    });
  }

  private referenceText(
    need: ConsultationNeedSnapshot,
    reason: RecommendationReason,
  ): string {
    const reference = reason.reference;

    if (reference.kind === 'criterion') {
      const criterion = need.memory.criteria.find(
        (item) => item.criterionId === reference.id,
      );

      if (!criterion || criterion.attributeId !== reason.attributeId) {
        throw new Error(
          `ConsultationCore: invalid criterion reference ${reference.id}`,
        );
      }

      return criterion.sourceText;
    }

    if (reference.kind === 'guidance') {
      const guidance = this.profile(need).guidance.find(
        (item) => item.id === reference.id,
      );

      if (!guidance || !guidance.attributeIds.includes(reason.attributeId)) {
        throw new Error(
          `ConsultationCore: invalid guidance reference ${reference.id}`,
        );
      }

      return guidance.instruction;
    }

    if (reference.kind === 'requirement') {
      const requirement = need.requirements.find(
        (item) => item.requirementId === reference.id,
      );

      if (!requirement || requirement.attributeId !== reason.attributeId) {
        throw new Error(
          `ConsultationCore: invalid requirement reference ${reference.id}`,
        );
      }

      return requirement.label;
    }

    if (reference.kind === 'goal') {
      const goal = need.memory.goals.find(
        (item) => item.goalId === reference.id,
      );

      if (!goal) {
        throw new Error(
          `ConsultationCore: invalid goal reference ${reference.id}`,
        );
      }

      this.assertProfileAttribute(need, reason.attributeId);
      return goal.text;
    }

    const preference = this.preferences(need).find(
      (item) => item.preferenceId === reference.id,
    );

    if (!preference) {
      throw new Error(
        `ConsultationCore: invalid preference reference ${reference.id}`,
      );
    }

    this.assertProfileAttribute(need, reason.attributeId);
    return preference.text;
  }

  private verifyReason(
    need: ConsultationNeedSnapshot,
    product: ProductDetails,
    reason: RecommendationReason,
  ) {
    const definition =
      reason.reference.kind === 'requirement'
        ? this.assertConsultationAttribute(need, reason.attributeId)
        : this.assertProfileAttribute(need, reason.attributeId);

    if (!this.isExposed(need.needId, product.id, reason.attributeId)) {
      throw new Error(
        `ConsultationCore: recommendation uses unexposed fact ${reason.attributeId}`,
      );
    }

    const fact = this.fact(product, definition);

    if (fact.status !== 'known') {
      throw new Error(
        `ConsultationCore: recommendation uses non-known fact ${reason.attributeId}`,
      );
    }

    return {
      ...reason,
      referenceText: this.referenceText(need, reason),
      fact,
    };
  }

  public verifyRecommendation(
    needId: string,
    rawRecommendation: unknown,
  ): VerifiedRecommendation {
    this.open();

    const need = this.need(needId);
    const recommendation = RecommendationPayloadSchema.parse(rawRecommendation);

    const product = this.assertLoadedProduct(need, recommendation.productId);

    const disliked = need.memory.feedback.find(
      (feedback) =>
        feedback.productId === product.id && feedback.reaction === 'dislike',
    );

    if (disliked) {
      throw new Error(
        `ConsultationCore: disliked product ${product.id} cannot be recommended`,
      );
    }

    const requirementChecks = this.requirements(need).map((requirement) =>
      this.checkRequirement(need, product, requirement),
    );

    const failedRequirement = requirementChecks.find(
      (check) => check.outcome !== 'pass',
    );

    if (failedRequirement) {
      throw new Error(
        `ConsultationCore: recommendation does not prove requirement ${failedRequirement.requirementId}`,
      );
    }

    const reasons = recommendation.reasons.map((reason) =>
      this.verifyReason(need, product, reason),
    );

    const tradeoffs = recommendation.tradeoffs.map((reason) =>
      this.verifyReason(need, product, reason),
    );

    const unknowns = unique(recommendation.unknowns);

    if (unknowns.length !== recommendation.unknowns.length) {
      throw new Error('ConsultationCore: duplicate recommendation unknown');
    }

    for (const attributeId of unknowns) {
      const definition = this.assertConsultationAttribute(need, attributeId);

      if (!this.isExposed(need.needId, product.id, attributeId)) {
        throw new Error(
          `ConsultationCore: recommendation unknown ${attributeId} was not exposed`,
        );
      }

      const fact = this.fact(product, definition);

      if (fact.status === 'known') {
        throw new Error(`ConsultationCore: ${attributeId} is not unknown`);
      }
    }

    return RecommendationSchema.parse({
      ...recommendation,
      needId: need.needId,
      profileId: need.profileId,
      profileVersion: this.profile(need).version,
      reasons,
      tradeoffs,
      unknowns,
    });
  }

  public artifacts(comparisonIds: string[]): {
    productDetails: z.infer<typeof ProductDetailsArtifactSchema>[];
    comparisons: z.infer<typeof ProductComparisonSchema>[];
  } {
    this.open();
    assertDistinct(comparisonIds, 'comparison artifact');

    const comparisons = comparisonIds.map((comparisonId) => {
      const comparison = this.comparisons.find(
        (item) => item.comparisonId === comparisonId,
      );

      if (!comparison) {
        throw new Error(`ConsultationCore: unknown comparison ${comparisonId}`);
      }

      if (comparison.memoryRevision !== this.revision(comparison.needId)) {
        throw new Error(`ConsultationCore: stale comparison ${comparisonId}`);
      }

      return structuredClone(comparison);
    });

    return {
      productDetails: [...this.detailArtifacts.values()].map((artifact) =>
        structuredClone(artifact),
      ),
      comparisons,
    };
  }

  public currentArtifacts(): ReturnType<ConsultationCore['artifacts']> {
    this.open();

    return this.artifacts(
      this.comparisons
        .filter((item) => item.memoryRevision === this.revision(item.needId))
        .map((item) => item.comparisonId),
    );
  }

  public usage(): {
    toolCalls: number;
    comparisonCalls: number;
  } {
    return {
      toolCalls: this.toolCalls,
      comparisonCalls: this.comparisonCalls,
    };
  }

  public seal(): void {
    this.open();
    this.sealed = true;
  }

  public committedMemories(): Array<{
    needId: string;
    memory: ConsultationMemory;
  }> {
    if (!this.sealed) {
      throw new Error(
        'ConsultationCore: consultation must be sealed before memory commit',
      );
    }

    return [...this.needs.values()].map((need) => ({
      needId: need.needId,
      memory: ConsultationMemorySchema.parse(structuredClone(need.memory)),
    }));
  }
}
