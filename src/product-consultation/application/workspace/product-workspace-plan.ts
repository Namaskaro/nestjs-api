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
import {
  MAX_PRODUCT_TASKS,
  type ProductTask,
  type ProductWorkspace,
} from './product-workspace';

const ExplicitTargetSchema = z
  .object({
    kind: z.literal('task'),
    taskId: z.string().trim().min(1).max(160),
    sourceText: z.string().trim().min(1).max(500),
  })
  .strict();
const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new') }).strict(),
  z
    .object({
      kind: z.literal('current'),
      view: z.enum(['focus', 'results']).default('focus'),
    })
    .strict(),
  z.object({ kind: z.literal('all') }).strict(),
  ExplicitTargetSchema,
]);

export const ProductWorkspacePlanSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('consult'),
              target: TargetSchema,
              query: z.string().trim().min(1).max(4000),
              decision: ProductConsultantDecisionSchema,
            })
            .strict(),
          z
            .object({ kind: z.literal('remove'), target: ExplicitTargetSchema })
            .strict(),
        ]),
      )
      .max(MAX_PRODUCT_TASKS),
    clarification: z.string().trim().min(1).max(6000).nullable(),
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
export type ProductWorkspacePlan = z.infer<typeof ProductWorkspacePlanSchema>;

export type PreparedProductOperation = {
  kind: 'consult' | 'remove';
  task: ProductTask;
  query: string;
  decision: ProductConsultantDecision | null;
};

export class ProductWorkspaceClarification extends Error {}
const clarify = (message: string): never => {
  throw new ProductWorkspaceClarification(message);
};
const normalize = (value: string) =>
  value.toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').trim();
const words = (value: string): string[] =>
  normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];

// A quoted task name must identify one task. Conservative lexical matching is
// deliberately allowed to clarify synonyms; it must never guess an ordinal's owner.
function explicitTask(
  workspace: ProductWorkspace,
  target: z.infer<typeof ExplicitTargetSchema>,
  query: string,
): ProductTask {
  if (!normalize(query).includes(normalize(target.sourceText))) {
    return clarify('Уточните, о какой подборке идёт речь.');
  }
  const terms = words(target.sourceText).filter(
    (word) =>
      word.length >= 3 &&
      ![
        'первый',
        'второй',
        'третий',
        'этот',
        'товар',
        'вариант',
        'подборка',
        'подборки',
        'подробнее',
      ].includes(word),
  );
  const candidates = workspace.tasks.filter((task) => {
    const identity = words(
      [
        task.record.state?.search?.semanticIntent ?? task.query,
        ...(task.record.results.active?.products.map(
          (product) => product.title,
        ) ?? []),
      ].join(' '),
    );
    return terms.some((term) =>
      identity.some(
        (word) =>
          word === term ||
          (word.length >= 5 &&
            term.length >= 5 &&
            word.slice(0, -1) === term.slice(0, -1)),
      ),
    );
  });
  if (candidates.length !== 1 || candidates[0].taskId !== target.taskId) {
    return clarify('Уточните, какую именно подборку вы имеете в виду.');
  }
  return candidates[0];
}

export function prepareProductWorkspacePlan(input: {
  workspace: ProductWorkspace;
  plan: ProductWorkspacePlan;
  query: string;
  conversationId: string;
  requestId: string;
  search: Pick<ProductSearchPort, 'validate'>;
}): PreparedProductOperation[] {
  const { workspace, plan } = input;
  const touched = new Set<string>();
  const expanded = plan.operations.flatMap((operation) => {
    if (operation.target.kind !== 'all')
      return [{ operation, globalTask: null as ProductTask | null }];
    if (
      operation.kind !== 'consult' ||
      operation.decision.proposal.action !== 'COMPLETE' ||
      plan.operations.length !== 1 ||
      !/(?:это\s+вс[её]|вс[её]\s+подбор|все\s+подбор|на\s+этом\s+закон|дальше\s+сам|закончим\s+подбор)/iu.test(
        input.query,
      )
    ) {
      return clarify('Завершить все подборки или одну из них?');
    }
    if (!workspace.tasks.length)
      return clarify('Сейчас нет открытых подборок.');
    return workspace.tasks.map((globalTask) => ({ operation, globalTask }));
  });
  const operations = expanded.map(
    ({ operation, globalTask }, index): PreparedProductOperation => {
      let task: ProductTask;
      if (globalTask) {
        task = globalTask;
      } else if (operation.target.kind === 'new') {
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
      } else if (operation.target.kind === 'current') {
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
            operation.decision.proposal.action,
          );
        let ids =
          answersQuestion && pending.length === 1
            ? [pending[0].taskId]
            : workspace.focus.length
            ? workspace.focus.map((focus) => focus.taskId)
            : workspace.tasks.map((task) => task.taskId);
        const selection =
          operation.kind === 'consult'
            ? operation.decision.proposal.selection ??
              operation.decision.proposal.feedback?.selection
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
              operation.target.kind === 'current' &&
              operation.target.view === 'focus' &&
              reference
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
      } else if (operation.target.kind === 'task') {
        task = explicitTask(workspace, operation.target, input.query);
      } else {
        return clarify('Уточните подборку.');
      }
      if (touched.has(task.taskId)) {
        return clarify('Уточните одно действие для каждой подборки.');
      }
      touched.add(task.taskId);
      if (operation.kind === 'remove') {
        return { kind: 'remove', task, query: input.query, decision: null };
      }
      const decision = structuredClone(operation.decision);
      if (
        operation.target.kind === 'new' &&
        decision.proposal.taskTransition !== 'start_new'
      ) {
        return clarify('Какой новый товар нужно подобрать?');
      }
      if (
        operation.target.kind !== 'new' &&
        decision.proposal.taskTransition === 'start_new'
      ) {
        return clarify('Нужен новый подбор или изменение существующего?');
      }
      if (
        operation.target.kind === 'current' &&
        operation.target.view === 'focus'
      ) {
        const focus = workspace.focus.find(
          (reference) => reference.taskId === task.taskId,
        );
        const remap = (selection: typeof decision.proposal.selection) => {
          if (!selection || !focus) return selection;
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
        if (decision.proposal.feedback)
          decision.proposal.feedback.selection = remap(
            decision.proposal.feedback.selection,
          )!;
      }
      // Use the existing Core as the only semantic validator, before any writes/searches.
      const category =
        decision.proposal.search?.category ??
        task.record.state?.search?.category;
      const prepared = prepareConsultationTurn({
        currentState: task.record.state,
        currentResults: task.record.results,
        proposal: decision.proposal,
        categoryProfile:
          CATEGORY_PROFILES.find((profile) => profile.id === category) ?? null,
        expectedResultId: task.record.results.active?.resultId ?? null,
      });
      if (prepared.turn.state.search)
        input.search.validate(prepared.turn.state.search);
      return { kind: 'consult', task, query: operation.query, decision };
    },
  );
  const remaining = workspace.tasks.filter(
    (task) =>
      !operations.some(
        (operation) =>
          operation.task.taskId === task.taskId &&
          (operation.kind === 'remove' ||
            operation.decision?.proposal.action === 'COMPLETE'),
      ),
  ).length;
  const created = operations.filter(
    (operation) =>
      !workspace.tasks.some((task) => task.taskId === operation.task.taskId),
  ).length;
  if (remaining + created > MAX_PRODUCT_TASKS) {
    return clarify(
      'Уже открыто пять подборок. Какую закрыть перед новым поиском?',
    );
  }
  return operations;
}
