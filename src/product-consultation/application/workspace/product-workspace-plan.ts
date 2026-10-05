import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  ProductConsultantDecisionSchema,
  type ProductConsultantDecision,
} from '../consultant/product-consultant-decision.schema';

import { createConsultationApplicationRecord } from '../runtime/consultation-application-record';

import { prepareConsultationTurn } from '../../core/turn/consultation-turn-boundary';

import { CATEGORY_PROFILES } from '../../core/profiles';

import type { ProductSearchPort } from '../search/product-search.port';

import type { ProductTask, ProductWorkspace } from './product-workspace';

const ProductLaneActionSchema = z
  .object({
    decision: ProductConsultantDecisionSchema,
    // null inherits the lane target's reference scope.
    view: z.enum(['focus', 'results']).nullable().default(null),
  })
  .strict();

const ExplicitTargetSchema = z
  .object({
    kind: z.literal('task'),

    taskId: z.string().trim().min(1).max(160),

    sourceText: z.string().trim().min(1).max(500),
  })
  .strict();

const TargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('new'),
    })
    .strict(),

  z
    .object({
      kind: z.literal('current'),

      view: z.enum(['focus', 'results']).default('focus'),
    })
    .strict(),

  z
    .object({
      kind: z.literal('all'),
    })
    .strict(),

  ExplicitTargetSchema,
]);

export const ProductWorkspacePlanSchema = z
  .object({
    operations: z.array(
      z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('consult'),

            target: TargetSchema,

            query: z.string().trim().min(1).max(4000),

            actions: z.array(ProductLaneActionSchema).min(1),
          })
          .strict(),

        z
          .object({
            kind: z.literal('remove'),

            target: ExplicitTargetSchema,
          })
          .strict(),
      ]),
    ),

    clarification: z.string().trim().min(1).max(6000).nullable(),
  })
  .strict()
  .superRefine((plan, context) => {
    // Transport/resource guard, not a task or action capacity rule.
    if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > 256 * 1024) {
      context.addIssue({
        code: 'custom',
        message: 'Product plan payload exceeds 256 KiB.',
      });
    }
    if ((plan.operations.length === 0) === (plan.clarification === null)) {
      context.addIssue({
        code: 'custom',

        message: 'Choose operations or workspace clarification.',
      });
    }
  });

export type ProductWorkspacePlan = z.infer<typeof ProductWorkspacePlanSchema>;

type ProductWorkspaceOperation = ProductWorkspacePlan['operations'][number];

export type ProductWorkspaceLifecycle = 'continue' | 'append' | 'replace';

export type PreparedProductAction = {
  decision: ProductConsultantDecision;
  view: 'focus' | 'results';
};

export type PreparedProductLane = {
  kind: 'consult' | 'remove';

  task: ProductTask;

  query: string;

  actions: PreparedProductAction[];
};

export class ProductWorkspaceClarification extends Error {}

const clarify = (message: string): never => {
  throw new ProductWorkspaceClarification(message);
};

const normalize = (value: string) =>
  value.toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').trim();

const words = (value: string): string[] =>
  normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];

const REFERENCE_WORDS = new Set([
  'первый',
  'первая',
  'первое',
  'второй',
  'вторая',
  'второе',
  'третий',
  'третья',
  'третье',
  'этот',
  'эта',
  'это',
  'эти',
  'товар',
  'товары',
  'вариант',
  'варианты',
  'подбор',
  'подборка',
  'подборки',
  'подробнее',
  'покажи',
  'показать',
  'найди',
  'найти',
  'подбери',
  'подобрать',
  'найденных',
  'выдачи',
]);

const APPEND_PATTERNS = [
  /^(?:а\s+|и\s+)?ещ[её](?=$|[^\p{L}\p{N}_])/iu,

  /^(?:а\s+|и\s+)?(?:также|плюс|добавь|добавьте)(?=$|[^\p{L}\p{N}_])/iu,

  /^(?:а\s+)?теперь\s+(?:ещ[её]|также|плюс|добавь|добавьте)(?=$|[^\p{L}\p{N}_])/iu,

  /^(?:а\s+)?к\s+(?:ним|этому|этим)(?:\s+ещ[её])?(?=$|[^\p{L}\p{N}_])/iu,
];

const ALL_COMPLETION_PATTERN =
  /(?:это\s+вс[её]|вс[её]\s+подбор|все\s+подбор|на\s+этом\s+закон|дальше\s+сам|закончим\s+подбор|закрой\s+все|закрыть\s+все|очисти\s+все|очистить\s+все|сбрось\s+все|сбросить\s+все)/iu;

function referenceTerms(value: string): string[] {
  return words(value).filter(
    (word) => word.length >= 3 && !REFERENCE_WORDS.has(word),
  );
}

function commonPrefixLength(
  left: string,

  right: string,
): number {
  const limit = Math.min(left.length, right.length);

  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function sameLexeme(
  leftRaw: string,

  rightRaw: string,
): boolean {
  const left = normalize(leftRaw);

  const right = normalize(rightRaw);

  if (left === right) {
    return true;
  }

  const shortest = Math.min(
    left.length,

    right.length,
  );

  if (shortest < 5) {
    return false;
  }

  return commonPrefixLength(left, right) >= Math.max(4, shortest - 2);
}

function taskIdentityWords(task: ProductTask): string[] {
  return words(
    [
      task.record.state?.search?.semanticIntent ?? task.query,

      ...(task.record.results.active?.products.map(
        (product) => product.title,
      ) ?? []),
    ].join(' '),
  );
}

function taskMatchesTerms(
  task: ProductTask,

  terms: readonly string[],
): boolean {
  if (terms.length === 0) {
    return false;
  }

  const identity = taskIdentityWords(task);

  return terms.some((term) => identity.some((word) => sameLexeme(word, term)));
}

function uniqueTaskFromText(
  workspace: ProductWorkspace,

  text: string,

  allowedTaskIds?: readonly string[],
): ProductTask | null {
  const terms = referenceTerms(text);

  if (terms.length === 0) {
    return null;
  }

  const allowed =
    allowedTaskIds && allowedTaskIds.length > 0
      ? new Set(allowedTaskIds)
      : null;

  const candidates = workspace.tasks.filter(
    (task) =>
      (!allowed || allowed.has(task.taskId)) && taskMatchesTerms(task, terms),
  );

  return candidates.length === 1 ? candidates[0] : null;
}

function explicitTask(
  workspace: ProductWorkspace,

  target: z.infer<typeof ExplicitTargetSchema>,

  query: string,
): ProductTask {
  const sourceTerms = referenceTerms(target.sourceText);

  const queryTerms = referenceTerms(query);

  if (
    sourceTerms.length === 0 ||
    !sourceTerms.some((sourceTerm) =>
      queryTerms.some((queryTerm) =>
        sameLexeme(
          sourceTerm,

          queryTerm,
        ),
      ),
    )
  ) {
    return clarify('Уточните, о какой подборке идёт речь.');
  }

  const candidates = workspace.tasks.filter((task) =>
    taskMatchesTerms(
      task,

      sourceTerms,
    ),
  );

  if (candidates.length !== 1 || candidates[0].taskId !== target.taskId) {
    return clarify('Уточните, какую именно подборку вы имеете в виду.');
  }

  return candidates[0];
}

function startsIndependentTask(operation: ProductWorkspaceOperation): boolean {
  return (
    operation.kind === 'consult' &&
    operation.actions[0].decision.proposal.taskTransition === 'start_new' &&
    (operation.actions[0].decision.proposal.action === 'SEARCH' ||
      operation.actions[0].decision.proposal.action === 'CLARIFY')
  );
}

export function isExplicitProductAppend(sourceQuery: string): boolean {
  const query = sourceQuery.trim();

  return APPEND_PATTERNS.some((pattern) => pattern.test(query));
}

export function resolveProductWorkspaceLifecycle(input: {
  plan: ProductWorkspacePlan;

  sourceQuery: string;
}): ProductWorkspaceLifecycle {
  if (input.plan.clarification !== null || input.plan.operations.length === 0) {
    return 'continue';
  }

  const allOperationsStartNew = input.plan.operations.every(
    startsIndependentTask,
  );

  if (!allOperationsStartNew) {
    return 'continue';
  }

  return isExplicitProductAppend(input.sourceQuery) ? 'append' : 'replace';
}

export function prepareProductWorkspacePlan(input: {
  workspace: ProductWorkspace;

  plan: ProductWorkspacePlan;

  query: string;

  sourceQuery?: string;

  conversationId: string;

  requestId: string;

  search: Pick<ProductSearchPort, 'validate'>;
}): PreparedProductLane[] {
  const { workspace } = input;
  const plan = ProductWorkspacePlanSchema.parse(input.plan);

  const touched = new Set<string>();

  const expanded = plan.operations.flatMap((operation) => {
    if (operation.target.kind !== 'all') {
      return [
        {
          operation,

          globalTask: null as ProductTask | null,
        },
      ];
    }

    if (
      operation.kind !== 'consult' ||
      operation.actions[0].decision.proposal.action !== 'COMPLETE' ||
      operation.actions.length !== 1 ||
      plan.operations.length !== 1 ||
      !ALL_COMPLETION_PATTERN.test(input.sourceQuery ?? input.query)
    ) {
      return clarify('Завершить все подборки или одну из них?');
    }

    if (!workspace.tasks.length) {
      return clarify('Сейчас нет открытых подборок.');
    }

    return workspace.tasks.map((globalTask) => ({
      operation,

      globalTask,
    }));
  });

  const operations = expanded.map(
    (
      {
        operation,

        globalTask,
      },

      index,
    ): PreparedProductLane => {
      const startsIndependent = startsIndependentTask(operation);

      if (
        operation.kind === 'consult' &&
        operation.target.kind === 'new' &&
        operation.actions[0].decision.proposal.taskTransition !== 'start_new'
      ) {
        return clarify('Какой новый товар нужно подобрать?');
      }

      const target = startsIndependent
        ? ({
            kind: 'new',
          } as const)
        : operation.target;

      let task: ProductTask;

      if (globalTask) {
        task = globalTask;
      } else if (target.kind === 'new') {
        task = {
          taskId: createHash('sha256')
            .update(
              JSON.stringify([input.conversationId, input.requestId, index]),
            )
            .digest('hex'),

          query: operation.kind === 'consult' ? operation.query : input.query,

          record: createConsultationApplicationRecord(),

          question: null,
        };
      } else if (target.kind === 'current') {
        const pending = workspace.tasks.filter(
          (task) =>
            task.question !== null &&
            (!workspace.focus.length ||
              workspace.focus.some(
                (reference) => reference.taskId === task.taskId,
              )),
        );

        const answersQuestion =
          operation.kind === 'consult' &&
          ['SEARCH', 'REFINE', 'CLARIFY'].includes(
            operation.actions[0].decision.proposal.action,
          );

        const scopedTaskIds =
          workspace.focus.length > 0
            ? workspace.focus.map((reference) => reference.taskId)
            : workspace.tasks.map((candidate) => candidate.taskId);

        const namedTask = uniqueTaskFromText(
          workspace,

          input.query,

          scopedTaskIds,
        );

        let ids = namedTask
          ? [namedTask.taskId]
          : answersQuestion && pending.length === 1
          ? [pending[0].taskId]
          : workspace.focus.length
          ? workspace.focus.map((focus) => focus.taskId)
          : workspace.tasks.map((candidate) => candidate.taskId);

        const selection =
          operation.kind === 'consult'
            ? operation.actions[0].decision.proposal.selection ??
              operation.actions[0].decision.proposal.feedback?.selection
            : null;

        if (selection) {
          ids = ids.filter((id) => {
            const candidate = workspace.tasks.find(
              (item) => item.taskId === id,
            )!;

            const reference = workspace.focus.find(
              (item) => item.taskId === id,
            );

            const count =
              target.view === 'focus' && reference
                ? reference.positions.length
                : candidate.record.results.active?.products.length ?? 0;

            return selection.kind === 'active'
              ? count > 0
              : selection.positions.every((position) => position <= count);
          });
        }

        if (ids.length !== 1) {
          return clarify(
            'Какую подборку вы имеете в виду? Укажите товар или название подбора.',
          );
        }

        task = workspace.tasks.find(
          (candidate) => candidate.taskId === ids[0],
        )!;
      } else if (target.kind === 'task') {
        task = explicitTask(
          workspace,

          target,

          input.query,
        );
      } else {
        return clarify('Уточните подборку.');
      }

      if (touched.has(task.taskId)) {
        return clarify('Уточните, что нужно сделать с выбранными товарами.');
      }

      touched.add(task.taskId);

      if (operation.kind === 'remove') {
        return {
          kind: 'remove',

          task,

          query: input.query,

          actions: [],
        };
      }

      const actions = operation.actions.map((action) => ({
        decision: structuredClone(action.decision),
        view:
          action.view ?? (target.kind === 'current' ? target.view : 'results'),
      }));
      preflightLane(
        task,
        actions,
        workspace.focus.find((f) => f.taskId === task.taskId),
        input.search,
      );
      return { kind: 'consult', task, query: operation.query, actions };
    },
  );
  return operations;
}

type TaskFocus = ProductWorkspace['focus'][number];

/** Resolves references afresh against the record returned by the preceding action. */
export function prepareProductTaskAction(
  task: ProductTask,
  action: PreparedProductAction,
  focus: TaskFocus | undefined,
  search: Pick<ProductSearchPort, 'validate'>,
) {
  const decision = structuredClone(action.decision);
  if (action.view === 'focus' && focus) {
    const remap = (selection: typeof decision.proposal.selection) => {
      if (!selection) return selection;
      if (focus.resultId !== task.record.results.active?.resultId) {
        return clarify(
          'Сначала покажем актуальную подборку. Какой товар вас интересует?',
        );
      }
      const positions =
        selection.kind === 'active'
          ? focus.positions
          : selection.positions.map(
              (position) => focus.positions[position - 1],
            );
      if (
        !positions.length ||
        positions.some((position) => position === undefined)
      ) {
        return clarify(
          'В обсуждаемом наборе нет такого номера. Уточните товар.',
        );
      }
      return { kind: 'positions' as const, positions };
    };
    decision.proposal.selection = remap(decision.proposal.selection);
    if (decision.proposal.feedback) {
      decision.proposal.feedback.selection = remap(
        decision.proposal.feedback.selection,
      )!;
    }
  }
  const category =
    decision.proposal.search?.category ?? task.record.state?.search?.category;
  const prepared = prepareConsultationTurn({
    currentState: task.record.state,
    currentResults: task.record.results,
    proposal: decision.proposal,
    categoryProfile:
      CATEGORY_PROFILES.find((profile) => profile.id === category) ?? null,
    expectedResultId: task.record.results.active?.resultId ?? null,
  });
  if (prepared.turn.state.search) search.validate(prepared.turn.state.search);
  return { decision, prepared };
}

export function productTaskFocus(
  task: ProductTask,
  decision: ProductConsultantDecision,
): TaskFocus {
  const snapshot = task.record.results.active;
  const selection =
    decision.proposal.selection ?? decision.proposal.feedback?.selection;
  return {
    taskId: task.taskId,
    resultId: snapshot?.resultId ?? null,
    positions: !snapshot
      ? []
      : selection?.kind === 'positions'
      ? selection.positions
      : snapshot.products.map((_, index) => index + 1),
  };
}

function preflightLane(
  initialTask: ProductTask,
  actions: PreparedProductAction[],
  initialFocus: TaskFocus | undefined,
  search: Pick<ProductSearchPort, 'validate'>,
) {
  const task = structuredClone(initialTask);
  let focus = initialFocus;
  let pendingResult = false;
  for (const [index, action] of actions.entries()) {
    const proposal = action.decision.proposal;
    if (index > 0 && proposal.taskTransition !== 'continue') {
      return clarify('Новый поиск должен принадлежать отдельной подборке.');
    }
    if (
      index < actions.length - 1 &&
      ['COMPLETE', 'CLARIFY', 'HANDOFF'].includes(proposal.action)
    ) {
      return clarify(
        'После завершения или уточняющего вопроса нужно дождаться ответа.',
      );
    }
    // Cardinality is structural even when the preceding search has not run yet.
    if (proposal.selection?.kind === 'positions') {
      const count = proposal.selection.positions.length;
      if (
        (proposal.action === 'DETAILS' && count !== 1) ||
        (proposal.action === 'COMPARE' && count < 2)
      ) {
        return clarify(
          'Подробности относятся к одному товару, сравнение - минимум к двум.',
        );
      }
    }
    if (proposal.search) search.validate({ version: 1, ...proposal.search });
    if (pendingResult) continue;
    const { decision, prepared } = prepareProductTaskAction(
      task,
      action,
      focus,
      search,
    );
    // This temporary preflight state is discarded; only WriteOwner accepts state.
    task.record.state = prepared.turn.state;
    pendingResult = prepared.turn.searchRequired;
    if (!pendingResult) focus = productTaskFocus(task, decision);
  }
}

export function productActionRequestId(
  parentRequestId: string,
  taskId: string,
  actionOrdinal: number,
): string {
  return `product-action-${createHash('sha256')
    .update(JSON.stringify([parentRequestId, taskId, actionOrdinal]))
    .digest('hex')}`;
}
