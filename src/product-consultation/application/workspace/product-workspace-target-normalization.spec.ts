import { describe, expect, it } from '@jest/globals';

import { ProductConsultantDecisionSchema } from '../consultant/product-consultant-decision.schema';

import { createConsultationApplicationRecord } from '../runtime/consultation-application-record';

import {
  beginSearchExecution,
  commitSearchExecution,
} from '../../core/results/consultation-results';

import { createProductConsultationState } from '../../core/state/consultation-state';

import { compileCurrentStoreSearchSpec } from '../../adapters/current-store/current-store-search-spec';

import {
  prepareProductWorkspacePlan,
  ProductWorkspaceClarification,
  ProductWorkspacePlanSchema,
} from './product-workspace-plan';

import {
  createProductWorkspace,
  ProductWorkspaceSchema,
} from './product-workspace';

function searchDecision(
  semanticIntent: string,

  category: 'SHOES' | 'CLOTHES',
) {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action: 'SEARCH',

      taskTransition: 'start_new',

      search: {
        semanticIntent,

        category,

        constraints: [],
      },
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: null,
  });
}

function detailsDecision() {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action: 'DETAILS',

      taskTransition: 'continue',

      selection: {
        kind: 'positions',

        positions: [2],
      },
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: null,
  });
}

function validateSearch() {
  return {
    validate: (search: Parameters<typeof compileCurrentStoreSearchSpec>[0]) => {
      compileCurrentStoreSearchSpec(search);
    },
  };
}

function staleWorkspace() {
  const record = createConsultationApplicationRecord();

  record.state = createProductConsultationState({
    semanticIntent: 'старый поиск Nike',

    category: 'SHOES',

    constraints: [],
  });

  return createProductWorkspace(record);
}

function searchedRecord(
  key: string,

  semanticIntent: string,

  category: 'SHOES' | 'CLOTHES',
) {
  const record = createConsultationApplicationRecord();

  record.state = createProductConsultationState({
    semanticIntent,

    category,

    constraints: [],
  });

  const started = beginSearchExecution(
    record.results,

    record.state.search!,

    () => `${key}-execution`,
  );

  record.results = commitSearchExecution(
    started.state,

    started.executionId,

    [
      {
        productId: `${key}-1`,

        title: `${semanticIntent} 1`,

        price: '1000',

        image: null,
      },
      {
        productId: `${key}-2`,

        title: `${semanticIntent} 2`,

        price: '2000',

        image: null,
      },
    ],

    () => `${key}-result`,
  );

  return record;
}

function twoTaskWorkspace() {
  const sneakers = searchedRecord(
    'sneakers',

    'мужские кроссовки',

    'SHOES',
  );

  const dress = searchedRecord(
    'dress',

    'женское платье',

    'CLOTHES',
  );

  return ProductWorkspaceSchema.parse({
    version: 1,

    tasks: [
      {
        taskId: 'sneakers-task',

        query: 'мужские кроссовки',

        record: sneakers,

        question: null,
      },
      {
        taskId: 'dress-task',

        query: 'женское платье',

        record: dress,

        question: null,
      },
    ],

    focus: [
      {
        taskId: 'sneakers-task',

        resultId: sneakers.results.active!.resultId,

        positions: [1, 2],
      },
      {
        taskId: 'dress-task',

        resultId: dress.results.active!.resultId,

        positions: [1, 2],
      },
    ],

    processedRequestIds: [],

    pendingClarification: {
      query: 'Покажи второй подробнее',

      question: 'Уточните, о какой подборке идёт речь.',
    },
  });
}

function parseSingleActionPlan(input: {
  operations: Array<Record<string, unknown>>;
  clarification: null;
}) {
  return ProductWorkspacePlanSchema.parse({
    ...input,
    operations: input.operations.map((operation) => {
      const { decision, ...lane } = operation;
      return { ...lane, actions: [{ decision }] };
    }),
  });
}

describe('Product workspace target normalization', () => {
  it('treats SEARCH start_new as a new task even when the model incorrectly targets current', () => {
    const workspace = staleWorkspace();

    const oldTaskId = workspace.tasks[0].taskId;

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'current',

            view: 'focus',
          },

          query: 'мужские кроссовки',

          decision: searchDecision(
            'мужские кроссовки',

            'SHOES',
          ),
        },
        {
          kind: 'consult',

          target: {
            kind: 'current',

            view: 'focus',
          },

          query: 'женское платье',

          decision: searchDecision(
            'женское платье',

            'CLOTHES',
          ),
        },
      ],

      clarification: null,
    });

    const operations = prepareProductWorkspacePlan({
      workspace,

      plan,

      query: 'Найди мужские кроссовки и женское платье',

      conversationId: 'conversation-1',

      requestId: 'request-1',

      search: validateSearch(),
    });

    expect(operations).toHaveLength(2);

    expect(operations.map((operation) => operation.task.taskId)).not.toContain(
      oldTaskId,
    );

    expect(
      new Set(operations.map((operation) => operation.task.taskId)).size,
    ).toBe(2);

    expect(operations.map((operation) => operation.query)).toEqual([
      'мужские кроссовки',

      'женское платье',
    ]);

    expect(workspace.tasks).toHaveLength(1);

    expect(workspace.tasks[0].taskId).toBe(oldTaskId);
  });

  it('does not guess an owner when target is new but the decision says continue', () => {
    const workspace = staleWorkspace();

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'new',
          },

          query: 'продолжение',

          decision: ProductConsultantDecisionSchema.parse({
            proposal: {
              action: 'CLARIFY',

              taskTransition: 'continue',
            },

            usageScenarioIds: [],

            factAttributeIds: [],

            terminalText: 'Что именно нужно уточнить?',
          }),
        },
      ],

      clarification: null,
    });

    expect(() =>
      prepareProductWorkspacePlan({
        workspace,

        plan,

        query: 'продолжение',

        conversationId: 'conversation-1',

        requestId: 'request-2',

        search: validateSearch(),
      }),
    ).toThrow(ProductWorkspaceClarification);
  });

  it('keeps SEARCH continue on the existing pre-search task', () => {
    const workspace = staleWorkspace();

    const oldTaskId = workspace.tasks[0].taskId;

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'current',

            view: 'focus',
          },

          query: 'Nike',

          decision: ProductConsultantDecisionSchema.parse({
            proposal: {
              action: 'SEARCH',

              taskTransition: 'continue',

              search: {
                semanticIntent: 'Nike',

                category: 'SHOES',

                constraints: [],
              },
            },

            usageScenarioIds: [],

            factAttributeIds: [],

            terminalText: null,
          }),
        },
      ],

      clarification: null,
    });

    const operations = prepareProductWorkspacePlan({
      workspace,

      plan,

      query: 'Nike',

      conversationId: 'conversation-1',

      requestId: 'request-3',

      search: validateSearch(),
    });

    expect(operations).toHaveLength(1);

    expect(operations[0].task.taskId).toBe(oldTaskId);

    expect(operations[0].actions[0].decision?.proposal.taskTransition).toBe(
      'continue',
    );
  });

  it('resolves a short clarification answer to the uniquely named focused task', () => {
    const workspace = twoTaskWorkspace();

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'current',

            view: 'focus',
          },

          query: 'кроссовки',

          decision: detailsDecision(),
        },
      ],

      clarification: null,
    });

    const operations = prepareProductWorkspacePlan({
      workspace,

      plan,

      query: 'кроссовки',

      conversationId: 'conversation-1',

      requestId: 'request-4',

      search: validateSearch(),
    });

    expect(operations).toHaveLength(1);

    expect(operations[0].task.taskId).toBe('sneakers-task');

    expect(operations[0].actions[0].decision?.proposal.selection).toEqual({
      kind: 'positions',

      positions: [2],
    });
  });

  it('resolves an inflected explicit task reference such as кроссовки versus кроссовок', () => {
    const workspace = twoTaskWorkspace();

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'task',

            taskId: 'sneakers-task',

            sourceText: 'кроссовки',
          },

          query: 'Покажи второй из кроссовок подробнее',

          decision: detailsDecision(),
        },
      ],

      clarification: null,
    });

    const operations = prepareProductWorkspacePlan({
      workspace,

      plan,

      query: 'Покажи второй из кроссовок подробнее',

      conversationId: 'conversation-1',

      requestId: 'request-5',

      search: validateSearch(),
    });

    expect(operations).toHaveLength(1);

    expect(operations[0].task.taskId).toBe('sneakers-task');
  });

  it('still refuses an ambiguous ordinal without a task name', () => {
    const workspace = twoTaskWorkspace();

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'current',

            view: 'focus',
          },

          query: 'Покажи второй подробнее',

          decision: detailsDecision(),
        },
      ],

      clarification: null,
    });

    expect(() =>
      prepareProductWorkspacePlan({
        workspace,

        plan,

        query: 'Покажи второй подробнее',

        conversationId: 'conversation-1',

        requestId: 'request-6',

        search: validateSearch(),
      }),
    ).toThrow(ProductWorkspaceClarification);
  });

  it('does not trust a fabricated task id even when the source text names another task', () => {
    const workspace = twoTaskWorkspace();

    const plan = parseSingleActionPlan({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'task',

            taskId: 'dress-task',

            sourceText: 'кроссовки',
          },

          query: 'Покажи второй из кроссовок подробнее',

          decision: detailsDecision(),
        },
      ],

      clarification: null,
    });

    expect(() =>
      prepareProductWorkspacePlan({
        workspace,

        plan,

        query: 'Покажи второй из кроссовок подробнее',

        conversationId: 'conversation-1',

        requestId: 'request-7',

        search: validateSearch(),
      }),
    ).toThrow(ProductWorkspaceClarification);
  });
});
