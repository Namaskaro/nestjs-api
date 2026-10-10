import { z } from 'zod';

import { ProductConsultantDecisionSchema } from '../consultant/product-consultant-decision.schema';

import {
  SearchSpecDraftSchema,
  SearchSpecPatchSchema,
} from '../../core/search/search-spec.schema';

import {
  CATEGORY_USAGE_KNOWLEDGE,
  getCategoryUsageKnowledge,
} from '../../core/profiles/usage-scenarios';

import {
  ProductSelectionSchema,
  PublicConsultationActionSchema,
} from '../../core/turn/consultation-turn.schema';

import { TurnFeedbackObservationSchema } from '../../core/turn/consultation-turn-proposal.schema';

import {
  ProductWorkspacePlanSchema,
  type ProductWorkspacePlan,
} from './product-workspace-plan';

const ProductWorkspaceViewSchema = z.enum(['focus', 'results', 'comparison']);

const ProductWorkspaceModelExplicitTargetSchema = z
  .object({
    kind: z.literal('task'),
    taskId: z.string().trim().min(1).max(160),
    sourceText: z.string().trim().min(1).max(500),
  })
  .strict();

const ProductWorkspaceModelTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('new'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('current'),
      view: ProductWorkspaceViewSchema.default('focus'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('all'),
    })
    .strict(),
  ProductWorkspaceModelExplicitTargetSchema,
]);

const ProductWorkspaceModelDecisionSchema = z
  .object({
    action: PublicConsultationActionSchema,
    search: SearchSpecDraftSchema.nullable().default(null),
    searchPatch: SearchSpecPatchSchema.nullable().default(null),
    selection: ProductSelectionSchema.nullable().default(null),
    feedback: TurnFeedbackObservationSchema.nullable().default(null),
    usageScenarioIds: z
      .array(z.string().trim().min(1).max(160))
      .max(3)
      .default(() => []),
    factAttributeIds: z
      .array(z.string().trim().min(1).max(160))
      .max(16)
      .default(() => []),
    terminalText: z.string().trim().min(1).max(6000).nullable().default(null),
  })
  .strict();

const ProductWorkspaceModelActionSchema = z
  .object({
    decision: ProductWorkspaceModelDecisionSchema,
    view: ProductWorkspaceViewSchema.nullable().default(null),
  })
  .strict();

export const ProductWorkspaceModelPlanSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('consult'),
              target: ProductWorkspaceModelTargetSchema,
              query: z.string().trim().min(1).max(4000),
              actions: z.array(ProductWorkspaceModelActionSchema).min(1),
            })
            .strict(),
          z
            .object({
              kind: z.literal('remove'),
              target: ProductWorkspaceModelExplicitTargetSchema,
            })
            .strict(),
        ]),
      )
      .default(() => []),
    clarification: z.string().trim().min(1).max(6000).nullable().default(null),
  })
  .strict()
  .superRefine((plan, context) => {
    if ((plan.operations.length === 0) === (plan.clarification === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Choose operations or workspace clarification.',
      });
    }
  });

type ProductWorkspaceModelPlan = z.infer<
  typeof ProductWorkspaceModelPlanSchema
>;

type ProductWorkspaceModelAction = z.infer<
  typeof ProductWorkspaceModelActionSchema
>;

type ProductWorkspaceModelTarget = z.infer<
  typeof ProductWorkspaceModelTargetSchema
>;

type ProductWorkspaceConsultOperation = Extract<
  ProductWorkspacePlan['operations'][number],
  {
    kind: 'consult';
  }
>;

type ProductWorkspaceAction =
  ProductWorkspaceConsultOperation['actions'][number];

type JsonRecord = Record<string, unknown>;

const ROOT_SELECTION_ACTIONS = new Set(['COMPARE', 'DETAILS', 'RECOMMEND']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSemanticText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeAttributeId(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[_\-\s]+/gu, '');
}

function constraintKey(raw: unknown): string | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (typeof raw.attributeId !== 'string' || typeof raw.operator !== 'string') {
    return null;
  }

  return `${raw.attributeId}:${raw.operator}`;
}

function isUsageScenarioConstraint(raw: unknown): boolean {
  if (!isRecord(raw) || typeof raw.attributeId !== 'string') {
    return false;
  }

  const attributeId = normalizeAttributeId(raw.attributeId);

  return attributeId === 'usagescenario' || attributeId === 'usecase';
}

function usageScenarioValue(raw: unknown): string | null {
  if (
    !isUsageScenarioConstraint(raw) ||
    !isRecord(raw) ||
    typeof raw.value !== 'string'
  ) {
    return null;
  }

  const value = raw.value.trim();

  return value || null;
}

function scenarioMatches(rawValue: string, candidate: string): boolean {
  const value = normalizeSemanticText(rawValue);
  const normalizedCandidate = normalizeSemanticText(candidate);

  if (value.length < 3 || normalizedCandidate.length < 3) {
    return false;
  }

  return (
    value === normalizedCandidate ||
    normalizedCandidate.includes(value) ||
    value.includes(normalizedCandidate)
  );
}

function inferUsageScenarioIds(input: {
  values: readonly string[];
  category: string | null;
}): string[] {
  if (input.values.length === 0) {
    return [];
  }

  const knowledge = input.category
    ? getCategoryUsageKnowledge(input.category)
    : null;

  const sources = knowledge ? [knowledge] : CATEGORY_USAGE_KNOWLEDGE;
  const matchedIds = new Set<string>();

  for (const value of input.values) {
    for (const source of sources) {
      for (const scenario of source.scenarios) {
        const candidates = [scenario.id, scenario.title, ...scenario.signals];

        if (candidates.some((candidate) => scenarioMatches(value, candidate))) {
          matchedIds.add(scenario.id);
        }
      }
    }
  }

  /*
   * Автоматически мигрируем legacy/ошибочный
   * usageScenario constraint только тогда,
   * когда значение однозначно соответствует
   * одному Usage Scenario.
   *
   * Неоднозначность не угадываем.
   */
  return matchedIds.size === 1 ? [...matchedIds] : [];
}

function stripTransportDecisionFields(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const {
    view: _view,
    target: _target,
    taskTransition: _taskTransition,
    ...decision
  } = raw;

  return decision;
}

function canonicalizeSearchDraft(raw: unknown): {
  value: unknown;
  usageScenarioValues: string[];
} {
  if (!isRecord(raw)) {
    return {
      value: raw,
      usageScenarioValues: [],
    };
  }

  if (!Array.isArray(raw.constraints)) {
    return {
      value: raw,
      usageScenarioValues: [],
    };
  }

  const usageScenarioValues = raw.constraints.flatMap((constraint) => {
    const value = usageScenarioValue(constraint);

    return value ? [value] : [];
  });

  return {
    value: {
      ...raw,
      constraints: raw.constraints.filter(
        (constraint) => !isUsageScenarioConstraint(constraint),
      ),
    },
    usageScenarioValues,
  };
}

function canonicalizeSearchPatch(
  raw: unknown,
  fallbackQuery?: string | null,
): {
  value: unknown;
  usageScenarioValues: string[];
} {
  if (!isRecord(raw)) {
    return {
      value: raw,
      usageScenarioValues: [],
    };
  }

  const rawSet = Array.isArray(raw.set) ? raw.set : [];
  const rawClear = Array.isArray(raw.clear) ? raw.clear : [];

  const usageScenarioValues = rawSet.flatMap((constraint) => {
    const value = usageScenarioValue(constraint);

    return value ? [value] : [];
  });

  const set = rawSet.filter(
    (constraint) => !isUsageScenarioConstraint(constraint),
  );

  const setKeys = new Set(
    set.flatMap((constraint) => {
      const key = constraintKey(constraint);

      return key ? [key] : [];
    }),
  );

  /*
   * Model-boundary tolerance.
   *
   * Для замены:
   *
   * color=white -> color=black
   *
   * достаточно:
   *
   * set color=black
   *
   * Если модель одновременно выдала
   * set + clear одного slot,
   * set является однозначным намерением
   * заменить значение и побеждает clear.
   *
   * Core schema при этом остаётся строгой.
   */
  const clear = rawClear.filter((selector) => {
    if (isUsageScenarioConstraint(selector)) {
      return false;
    }

    const key = constraintKey(selector);

    if (key && setKeys.has(key)) {
      return false;
    }

    return true;
  });

  const fallback = fallbackQuery?.trim();

  const hasSemanticIntent =
    typeof raw.semanticIntent === 'string' &&
    raw.semanticIntent.trim().length > 0;

  return {
    value: {
      ...raw,
      /*
       * Если модель ошибочно пыталась
       * выразить soft goal через
       * usageScenario constraint,
       * сохраняем пользовательский смысл
       * в semantic retrieval query.
       */
      ...(usageScenarioValues.length > 0 && !hasSemanticIntent && fallback
        ? {
            semanticIntent: fallback,
          }
        : {}),
      set,
      clear,
    },
    usageScenarioValues,
  };
}

function canonicalizeModelDecision(
  raw: unknown,
  fallbackQuery?: string | null,
): unknown {
  const stripped = stripTransportDecisionFields(raw);

  if (!isRecord(stripped)) {
    return stripped;
  }

  /*
   * Workspace Planner не владеет persistent memory.
   *
   * Даже если provider вернул legacy memoryObservations
   * в raw tool arguments, optional memory enrichment
   * не должно ломать основной SEARCH / REFINE.
   */
  const { memoryObservations: _memoryObservations, ...decision } = stripped;

  const search = canonicalizeSearchDraft(decision.search);

  const searchPatch = canonicalizeSearchPatch(
    decision.searchPatch,
    fallbackQuery,
  );

  const category =
    isRecord(search.value) && typeof search.value.category === 'string'
      ? search.value.category
      : isRecord(searchPatch.value) &&
        typeof searchPatch.value.category === 'string'
      ? searchPatch.value.category
      : null;

  const existingScenarioIds = Array.isArray(decision.usageScenarioIds)
    ? decision.usageScenarioIds.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      )
    : [];

  const inferredScenarioIds =
    existingScenarioIds.length > 0
      ? []
      : inferUsageScenarioIds({
          values: [
            ...search.usageScenarioValues,
            ...searchPatch.usageScenarioValues,
          ],
          category,
        });

  return {
    ...decision,
    search: search.value,
    searchPatch: searchPatch.value,
    ...(existingScenarioIds.length > 0 || inferredScenarioIds.length > 0
      ? {
          usageScenarioIds: [
            ...new Set([...existingScenarioIds, ...inferredScenarioIds]),
          ].slice(0, 3),
        }
      : {}),
  };
}

function actionView(action: JsonRecord): unknown {
  if (action.view !== undefined) {
    return action.view;
  }

  if (isRecord(action.decision) && action.decision.view !== undefined) {
    return action.decision.view;
  }

  return null;
}

function actionTarget(action: JsonRecord): unknown | null {
  if (action.target !== undefined) {
    return action.target;
  }

  if (isRecord(action.decision) && action.decision.target !== undefined) {
    return action.decision.target;
  }

  return null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sharedActionTarget(actions: readonly unknown[]): unknown | null {
  const targets = actions
    .filter(isRecord)
    .map(actionTarget)
    .filter((target): target is unknown => target !== null);

  if (targets.length === 0) {
    return null;
  }

  const first = targets[0];

  if (targets.some((target) => !sameJson(target, first))) {
    throw new Error(
      'ProductWorkspaceModelPlan: one lane cannot contain conflicting targets.',
    );
  }

  return first;
}

function decisionAction(decision: unknown): string | null {
  if (!isRecord(decision) || typeof decision.action !== 'string') {
    return null;
  }

  return decision.action;
}

function decisionSearchSemanticIntent(decision: unknown): string | null {
  if (!isRecord(decision) || !isRecord(decision.search)) {
    return null;
  }

  const semanticIntent = decision.search.semanticIntent;

  return typeof semanticIntent === 'string' && semanticIntent.trim()
    ? semanticIntent.trim()
    : null;
}

function targetSourceText(target: unknown): string | null {
  if (!isRecord(target)) {
    return null;
  }

  return typeof target.sourceText === 'string' && target.sourceText.trim()
    ? target.sourceText.trim()
    : null;
}

function currentView(
  actions: readonly unknown[],
): 'focus' | 'results' | 'comparison' {
  const first = actions.find(isRecord);

  if (!first) {
    return 'focus';
  }

  const view = actionView(first);

  return view === 'results' || view === 'comparison' || view === 'focus'
    ? view
    : 'focus';
}

function inferOperationTarget(
  operation: JsonRecord,
  actions: readonly unknown[],
): unknown {
  if (operation.target !== null && operation.target !== undefined) {
    return operation.target;
  }

  const shared = sharedActionTarget(actions);

  if (shared !== null) {
    return shared;
  }

  const first = actions.find(isRecord);
  const decision = first?.decision !== undefined ? first.decision : first;
  const action = decisionAction(decision);

  if (action === 'SEARCH' || action === 'CLARIFY') {
    return {
      kind: 'new',
    };
  }

  return {
    kind: 'current',
    view: currentView(actions),
  };
}

function inferOperationQuery(input: {
  operation: JsonRecord;
  target: unknown;
  decisions: readonly unknown[];
  fallbackQuery?: string | null;
}): string | null {
  if (
    typeof input.operation.query === 'string' &&
    input.operation.query.trim()
  ) {
    return input.operation.query.trim();
  }

  for (const decision of input.decisions) {
    const semanticIntent = decisionSearchSemanticIntent(decision);

    if (semanticIntent) {
      return semanticIntent;
    }
  }

  const sourceText = targetSourceText(input.target);

  if (sourceText) {
    return sourceText;
  }

  const fallback = input.fallbackQuery?.trim();

  return fallback || null;
}

function canonicalizeAction(
  raw: unknown,
  fallbackQuery?: string | null,
): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const decision = raw.decision !== undefined ? raw.decision : raw;

  return {
    decision: canonicalizeModelDecision(decision, fallbackQuery),
    view: actionView(raw),
  };
}

function canonicalizeOperation(
  raw: unknown,
  fallbackQuery?: string | null,
): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  if (
    Array.isArray(raw.operations) &&
    raw.operations.length === 1 &&
    isRecord(raw.operations[0])
  ) {
    const nested = raw.operations[0];

    return canonicalizeOperation(
      {
        ...nested,
        target: raw.target ?? nested.target,
        query: raw.query ?? nested.query,
      },
      fallbackQuery,
    );
  }

  if (raw.kind === 'remove') {
    return raw;
  }

  if (Array.isArray(raw.actions)) {
    const decisions = raw.actions
      .filter(isRecord)
      .map((action) =>
        action.decision !== undefined ? action.decision : action,
      );

    const target = inferOperationTarget(raw, raw.actions);

    const query = inferOperationQuery({
      operation: raw,
      target,
      decisions,
      fallbackQuery,
    });

    return {
      kind: 'consult',
      target,
      query,
      actions: raw.actions.map((action) =>
        canonicalizeAction(action, query ?? fallbackQuery),
      ),
    };
  }

  if (raw.decision !== undefined) {
    const actions = [raw];

    const target = inferOperationTarget(raw, actions);

    const query = inferOperationQuery({
      operation: raw,
      target,
      decisions: [raw.decision],
      fallbackQuery,
    });

    return {
      kind: 'consult',
      target,
      query,
      actions: [canonicalizeAction(raw, query ?? fallbackQuery)],
    };
  }

  return raw;
}

function canonicalizeProductWorkspaceModelPlan(
  raw: unknown,
  fallbackQuery?: string | null,
): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  if (!Array.isArray(raw.operations)) {
    return raw;
  }

  return {
    ...raw,
    operations: raw.operations.map((operation) =>
      canonicalizeOperation(operation, fallbackQuery),
    ),
  };
}

function normalizeRootSelection(raw: ProductWorkspaceModelAction['decision']) {
  return ROOT_SELECTION_ACTIONS.has(raw.action) ? raw.selection : null;
}

function taskTransition(
  action: ProductWorkspaceModelAction['decision']['action'],
  target: ProductWorkspaceModelTarget,
  actionOrdinal: number,
): 'continue' | 'start_new' {
  if (
    actionOrdinal === 0 &&
    target.kind === 'new' &&
    (action === 'SEARCH' || action === 'CLARIFY')
  ) {
    return 'start_new';
  }

  return 'continue';
}

function terminalText(
  raw: ProductWorkspaceModelAction['decision'],
): string | null {
  if (raw.terminalText !== null) {
    return raw.terminalText;
  }

  if (raw.action === 'COMPLETE') {
    return 'Спасибо за консультацию. Если понадобится помощь с выбором — обращайтесь.';
  }

  return null;
}

function normalizeDecision(
  raw: ProductWorkspaceModelAction['decision'],
  target: ProductWorkspaceModelTarget,
  actionOrdinal: number,
) {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action: raw.action,
      taskTransition: taskTransition(raw.action, target, actionOrdinal),
      search: raw.search,
      searchPatch: raw.searchPatch,

      /*
       * Workspace planner больше не владеет memory.
       * Persistent memory обновляется отдельным механизмом.
       */
      memoryObservations: [],

      selection: normalizeRootSelection(raw),
      feedback: raw.feedback,
    },
    usageScenarioIds: raw.usageScenarioIds,
    factAttributeIds: raw.factAttributeIds,
    terminalText: terminalText(raw),
  });
}

function normalizeAction(
  action: ProductWorkspaceModelAction,
  target: ProductWorkspaceModelTarget,
  actionOrdinal: number,
): ProductWorkspaceAction[] {
  const decision = action.decision;

  const positions =
    decision.action === 'DETAILS' && decision.selection?.kind === 'positions'
      ? decision.selection.positions
      : null;

  if (!positions || positions.length <= 1) {
    return [
      {
        decision: normalizeDecision(decision, target, actionOrdinal),
        view: action.view,
      },
    ];
  }

  return positions.map(
    (position): ProductWorkspaceAction => ({
      decision: normalizeDecision(
        {
          ...decision,
          selection: {
            kind: 'positions',
            positions: [position],
          },
        },
        target,
        actionOrdinal,
      ),
      view: action.view,
    }),
  );
}

export function normalizeProductWorkspaceModelPlan(
  raw: unknown,
  fallbackQuery?: string | null,
): ProductWorkspacePlan {
  const canonical = canonicalizeProductWorkspaceModelPlan(raw, fallbackQuery);

  const modelPlan: ProductWorkspaceModelPlan =
    ProductWorkspaceModelPlanSchema.parse(canonical);

  const normalized = {
    operations: modelPlan.operations.map((operation) => {
      if (operation.kind === 'remove') {
        return {
          kind: 'remove' as const,
          target: operation.target,
        };
      }

      return {
        kind: 'consult' as const,
        target: operation.target,
        query: operation.query,
        actions: operation.actions.flatMap((action, actionOrdinal) =>
          normalizeAction(action, operation.target, actionOrdinal),
        ),
      };
    }),
    clarification: modelPlan.clarification,
  };

  return ProductWorkspacePlanSchema.parse(normalized);
}
