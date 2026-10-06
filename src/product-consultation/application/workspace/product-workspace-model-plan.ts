import { z } from 'zod';

import { ProductConsultantDecisionSchema } from '../consultant/product-consultant-decision.schema';

import { ConsultationMemoryObservationsSchema } from '../../core/memory/consultation-memory-observation.schema';

import {
  SearchSpecDraftSchema,
  SearchSpecPatchSchema,
} from '../../core/search/search-spec.schema';

import {
  ProductSelectionSchema,
  PublicConsultationActionSchema,
} from '../../core/turn/consultation-turn.schema';

import {
  ConsultationTaskTransitionSchema,
  TurnFeedbackObservationSchema,
} from '../../core/turn/consultation-turn-proposal.schema';

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

    taskTransition: ConsultationTaskTransitionSchema,

    search: SearchSpecDraftSchema.nullable().default(null),

    searchPatch: SearchSpecPatchSchema.nullable().default(null),

    memoryObservations: ConsultationMemoryObservationsSchema.default(() => []),

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

function stripTransportDecisionFields(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const {
    view: _view,

    target: _target,

    ...decision
  } = raw;

  return decision;
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

function sameJson(
  left: unknown,

  right: unknown,
): boolean {
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

  if (
    targets.some(
      (target) =>
        !sameJson(
          target,

          first,
        ),
    )
  ) {
    return null;
  }

  return first;
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

function canonicalizeAction(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const decision = raw.decision !== undefined ? raw.decision : raw;

  return {
    decision: stripTransportDecisionFields(decision),

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

  if (raw.kind === 'remove') {
    return raw;
  }

  if (Array.isArray(raw.actions)) {
    const target = raw.target ?? sharedActionTarget(raw.actions);

    const decisions = raw.actions
      .filter(isRecord)
      .map((action) =>
        action.decision !== undefined ? action.decision : action,
      );

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

      actions: raw.actions.map(canonicalizeAction),
    };
  }

  if (raw.decision !== undefined) {
    const target = raw.target;

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

      actions: [
        {
          decision: stripTransportDecisionFields(raw.decision),

          view:
            raw.view ??
            (isRecord(raw.decision) ? raw.decision.view ?? null : null),
        },
      ],
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
      canonicalizeOperation(
        operation,

        fallbackQuery,
      ),
    ),
  };
}

function normalizeRootSelection(raw: ProductWorkspaceModelAction['decision']) {
  return ROOT_SELECTION_ACTIONS.has(raw.action) ? raw.selection : null;
}

function normalizeDecision(raw: ProductWorkspaceModelAction['decision']) {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action: raw.action,

      taskTransition: raw.taskTransition,

      search: raw.search,

      searchPatch: raw.searchPatch,

      memoryObservations: raw.memoryObservations,

      selection: normalizeRootSelection(raw),

      feedback: raw.feedback,
    },

    usageScenarioIds: raw.usageScenarioIds,

    factAttributeIds: raw.factAttributeIds,

    terminalText: raw.terminalText,
  });
}

function normalizeAction(
  action: ProductWorkspaceModelAction,
): ProductWorkspaceAction[] {
  const decision = action.decision;

  const positions =
    decision.action === 'DETAILS' && decision.selection?.kind === 'positions'
      ? decision.selection.positions
      : null;

  if (!positions || positions.length <= 1) {
    return [
      {
        decision: normalizeDecision(decision),

        view: action.view,
      },
    ];
  }

  return positions.map(
    (position): ProductWorkspaceAction => ({
      decision: normalizeDecision({
        ...decision,

        selection: {
          kind: 'positions',

          positions: [position],
        },
      }),

      view: action.view,
    }),
  );
}

export function normalizeProductWorkspaceModelPlan(
  raw: unknown,

  fallbackQuery?: string | null,
): ProductWorkspacePlan {
  const canonical = canonicalizeProductWorkspaceModelPlan(
    raw,

    fallbackQuery,
  );

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

        actions: operation.actions.flatMap(normalizeAction),
      };
    }),

    clarification: modelPlan.clarification,
  };

  return ProductWorkspacePlanSchema.parse(normalized);
}
