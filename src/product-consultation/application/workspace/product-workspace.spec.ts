import { describe, expect, it, jest } from '@jest/globals';

import type { AiService } from '@/src/ai/ai.service';

import { createProductAgent } from '../agent/product.agent';

import type { ProductAgentService } from '../agent/product-agent.service';

import { ProductConsultantDecisionSchema } from '../consultant/product-consultant-decision.schema';

import {
  ProductWorkspacePlanSchema,
  type ProductWorkspacePlan,
} from './product-workspace-plan';

import {
  createProductWorkspace,
  type ProductWorkspace,
} from './product-workspace';

import {
  CURRENT_STORE_SEARCH_CAPABILITIES,
  compileCurrentStoreSearchSpec,
} from '../../adapters/current-store/current-store-search-spec';

import type { SearchSpec } from '../../core/search/search-spec.schema';

import type { ConsultationResultProduct } from '../../core/results/consultation-results.schema';

import type { ProductDetails } from '../../core/consultation-core.schema';

import { CurrentProductConsultationTarget } from '../../evaluation/targets/current-product-consultation.target';

import { FrozenCurrentProductConsultationTarget } from '../../evaluation/targets/frozen-current-product-consultation.target';

import { loadCurrentProductConsultationFixture } from '../../evaluation/fixtures/current-product-consultation.fixture';

import { ProductWorkspaceSchema } from './product-workspace';

const constraint = (
  attributeId: string,

  value: string | number,

  operator = 'eq',
) => ({
  attributeId,

  operator,

  value,

  unit: null,
});

function decision(
  action: string,

  extra: Record<string, unknown> = {},
) {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action,

      taskTransition: action === 'SEARCH' ? 'start_new' : 'continue',

      ...extra,
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: ['CLARIFY', 'FEEDBACK', 'COMPLETE', 'HANDOFF'].includes(
      action,
    )
      ? 'Готово.'
      : null,
  });
}

function search(
  query: string,

  category = 'SHOES',

  constraints: unknown[] = [],
) {
  return {
    kind: 'consult',

    target: {
      kind: 'new',
    },

    query,

    decision: decision(
      'SEARCH',

      {
        search: {
          semanticIntent: query,

          category,

          constraints,
        },
      },
    ),
  };
}

function existing(
  action: string,

  extra: Record<string, unknown> = {},

  target: unknown = {
    kind: 'current',
  },

  query = 'Продолжение',
) {
  return {
    kind: 'consult',

    target,

    query,

    decision: decision(
      action,

      extra,
    ),
  };
}

const named = (
  workspace: ProductWorkspace,

  index: number,

  sourceText: string,
) => ({
  kind: 'task',

  taskId: workspace.tasks[index].taskId,

  sourceText,
});

const plan = (...operations: unknown[]) =>
  ProductWorkspacePlanSchema.parse({
    operations: operations.map((raw) => {
      const operation = raw as Record<string, unknown>;

      if (operation.kind !== 'consult' || operation.actions) {
        return operation;
      }

      const { decision, ...lane } = operation;

      return {
        ...lane,

        actions: [
          {
            decision,
          },
        ],
      };
    }),

    clarification: null,
  });

const pair = () =>
  plan(
    search(
      'мужские кроссовки Nike',

      'SHOES',

      [
        constraint(
          'gender',

          'MAN',
        ),

        constraint(
          'brand',

          'Nike',
        ),
      ],
    ),

    search(
      'женское платье',

      'CLOTHES',

      [
        constraint(
          'gender',

          'WOMAN',
        ),
      ],
    ),
  );

function products(spec: SearchSpec): ConsultationResultProduct[] {
  return [1, 2, 3].map((n) => ({
    productId: `${spec.semanticIntent}-${n}`,

    title: `${spec.semanticIntent} ${n}`,

    price: String(1000 * n),

    image: null,
  }));
}

function details(id: string): ProductDetails {
  return {
    id,

    title: id,

    description: 'Описание из каталога',

    productType: 'SHOES',

    profileId: 'SHOES',

    price: '1000',

    currency: 'RUB',

    discount: null,

    images: [],

    availability: {
      inStock: true,

      stock: 2,
    },

    brand: null,

    category: null,

    subcategory: null,

    attributes: [],

    source: {
      sourceId: 'fixture',

      recordId: id,

      observedAt: '2026-10-01T00:00:00.000Z',

      updatedAt: null,
    },
  };
}

function recommendationPositionFromMessages(messages: unknown): number {
  if (!Array.isArray(messages)) {
    return 1;
  }

  const last = messages.at(-1);

  if (
    typeof last !== 'object' ||
    last === null ||
    !('content' in last) ||
    typeof last.content !== 'string'
  ) {
    return 1;
  }

  try {
    const payload = JSON.parse(last.content) as {
      context?: {
        productFacts?: Array<{
          position?: number;
        }>;
      };
    };

    const position = payload.context?.productFacts?.[0]?.position;

    return typeof position === 'number' && Number.isInteger(position)
      ? position
      : 1;
  } catch {
    return 1;
  }
}

function harness(initialPlan = pair()) {
  let nextPlan = initialPlan;

  const decide = jest.fn(async (_messages: unknown) => nextPlan);

  const respond = jest.fn(async (messages: unknown) => ({
    message: 'Рекомендация по данным каталога.',

    recommendedPosition: recommendationPositionFromMessages(messages),
  }));

  const invoke = jest.fn(async () => ({
    text: 'Рекомендация по данным каталога.',
  }));

  const model = {
    invoke,

    withStructuredOutput: (
      _schema: unknown,

      options: {
        name: string;
      },
    ) => {
      const runnable = {
        invoke:
          options.name === 'product_workspace_decision'
            ? decide
            : options.name === 'product_recommendation_response'
            ? respond
            : jest.fn(async () => null),

        withRetry: () => runnable,
      };

      return runnable;
    },
  };

  const service = {
    capabilities: () => CURRENT_STORE_SEARCH_CAPABILITIES,

    validate: (spec: SearchSpec) => {
      compileCurrentStoreSearchSpec(spec);
    },

    search: jest.fn(async (spec: SearchSpec) => products(spec)),

    getProductDetails: jest.fn(async (ids: readonly string[]) =>
      ids.map(details),
    ),

    getProductSemanticRepresentations: jest.fn(
      async (_ids: readonly string[]) => new Map(),
    ),
  };

  const agent = createProductAgent(
    {
      getChatModel: () => model,
    } as unknown as AiService,

    service as unknown as ProductAgentService,
  );

  let serial = 0;

  return {
    aiService: {
      getChatModel: () => model,
    } as unknown as AiService,

    service,

    decide,

    respond,

    agent,

    setPlan(value: ProductWorkspacePlan) {
      nextPlan = value;
    },

    run(
      query = 'Найди мужские кроссовки Nike и женское платье',

      workspace = createProductWorkspace(),

      requestId = `request-${++serial}`,

      sourceQuery?: string,
    ) {
      return agent.invoke({
        query,

        sourceQuery: sourceQuery ?? query,

        workspace,

        requestId,

        conversationId: 'conversation-1',
      });
    },
  };
}

describe('Product workspace: real graph with offline model boundary', () => {
  it('MI-02 one invocation, one decision call, two normalized independent tasks and ordered groups', async () => {
    const h = harness();

    const result = await h.run();

    expect(h.decide).toHaveBeenCalledTimes(1);

    expect(h.respond).not.toHaveBeenCalled();

    expect(result.workspace.tasks).toHaveLength(2);

    expect(h.service.search).toHaveBeenCalledTimes(2);

    expect(result.groups.map((group) => group.query)).toEqual([
      'мужские кроссовки Nike',

      'женское платье',
    ]);

    expect(result.groups.map((group) => group.taskId)).toEqual(
      result.workspace.tasks.map((task) => task.taskId),
    );

    expect(
      result.workspace.tasks.every(
        (task) => task.record.generation === 1 && task.record.revision === 2,
      ),
    ).toBe(true);

    expect(
      result.groups[0].products.every((product) => product.id.includes('Nike')),
    ).toBe(true);

    expect(
      result.groups[1].products.every((product) =>
        product.id.includes('платье'),
      ),
    ).toBe(true);
  });

  it('MI-03 gender, brand, size and wedding goal stay in their own SearchSpec/Memory', async () => {
    const nike = search(
      'женские Nike 42 размера',

      'SHOES',

      [
        constraint(
          'gender',

          'WOMAN',
        ),

        constraint(
          'brand',

          'Nike',
        ),

        constraint(
          'sizes',

          '42',

          'contains',
        ),
      ],
    );

    const suit = search(
      'костюм на свадьбу',

      'CLOTHES',
    );

    suit.decision.proposal.memoryObservations = [
      {
        kind: 'goal',

        operation: 'remember',

        text: 'на свадьбу',

        importance: 'normal',

        sourceText: 'костюм на свадьбу',
      },
    ];

    const h = harness(
      plan(
        nike,

        suit,
      ),
    );

    const result = await h.run(
      'Найди женские Nike 42 размера и костюм на свадьбу',
    );

    expect(
      h.service.search.mock.calls[0][0].constraints.map(
        (item) => item.attributeId,
      ),
    ).toEqual(['gender', 'brand', 'sizes']);

    expect(h.service.search.mock.calls[1][0].constraints).toEqual([]);

    expect(result.workspace.tasks[0].record.state!.memory.memory.goals).toEqual(
      [],
    );

    expect(
      result.workspace.tasks[1].record.state!.memory.memory.goals[0].text,
    ).toBe('на свадьбу');
  });

  it('MI-04 adding a task preserves existing task, memory, results and revision', async () => {
    const h = harness(plan(search('Nike')));

    const first = await h.run('Найди Nike');

    h.setPlan(
      plan(
        search(
          'женское платье',

          'CLOTHES',
        ),
      ),
    );

    const next = await h.run(
      'А ещё найди женское платье',

      first.workspace,
    );

    expect(next.workspace.tasks).toHaveLength(2);

    expect(next.workspace.tasks[0]).toEqual(first.workspace.tasks[0]);

    expect(next.groups).toHaveLength(1);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('MI-05 refuses ambiguous relative references and fabricated explicit ownership', async () => {
    const h = harness();

    const first = await h.run();

    h.service.getProductDetails.mockClear();

    h.setPlan(
      plan(
        existing(
          'DETAILS',

          {
            selection: {
              kind: 'positions',

              positions: [2],
            },
          },
        ),
      ),
    );

    const ambiguous = await h.run(
      'Покажи второй подробнее',

      first.workspace,
    );

    expect(ambiguous.message).toContain('Какую подборку');

    expect(ambiguous.workspace.tasks).toEqual(first.workspace.tasks);

    expect(h.service.getProductDetails).not.toHaveBeenCalled();

    h.setPlan(
      plan(
        existing(
          'DETAILS',

          {
            selection: {
              kind: 'positions',

              positions: [2],
            },
          },

          named(
            first.workspace,

            0,

            'второй',
          ),
        ),
      ),
    );

    const guessed = await h.run(
      'Покажи второй подробнее',

      first.workspace,
    );

    expect(guessed.groups).toHaveLength(0);

    expect(h.service.getProductDetails).not.toHaveBeenCalled();
  });

  it('MI-05 resolves a unique group and keeps comparison reference order without extra LLM response', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(
        existing(
          'COMPARE',

          {
            selection: {
              kind: 'positions',

              positions: [3, 1],
            },
          },

          named(
            first.workspace,

            0,

            'Nike',
          ),

          'Сравни Nike третий и первый',
        ),
      ),
    );

    const compared = await h.run(
      'Сравни Nike третий и первый',

      first.workspace,
    );

    expect(compared.workspace.focus[0].positions).toEqual([3, 1]);

    h.setPlan(
      plan(
        existing(
          'DETAILS',

          {
            selection: {
              kind: 'positions',

              positions: [2],
            },
          },
        ),
      ),
    );

    const next = await h.run(
      'Покажи второй подробнее',

      compared.workspace,
    );

    expect(h.service.getProductDetails).toHaveBeenLastCalledWith([
      'мужские кроссовки Nike-1',
    ]);

    expect(next.consultation?.productDetailsPresentation).toBeTruthy();

    expect(h.respond).not.toHaveBeenCalled();
  });

  it('MI-06 refines only the named task', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(
        existing(
          'REFINE',

          {
            searchPatch: {
              set: [
                constraint(
                  'price',

                  10000,

                  'lte',
                ),
              ],

              clear: [],
            },
          },

          named(
            first.workspace,

            0,

            'Nike',
          ),

          'Nike до 10000',
        ),
      ),
    );

    const next = await h.run(
      'Nike до 10000',

      first.workspace,
    );

    expect(next.workspace.tasks[1]).toEqual(first.workspace.tasks[1]);

    expect(
      next.workspace.tasks[0].record.state!.search!.constraints,
    ).toContainEqual(
      constraint(
        'price',

        10000,

        'lte',
      ),
    );

    expect(next.workspace.tasks[0].record.generation).toBe(1);

    expect(h.service.search).toHaveBeenCalledTimes(3);
  });

  it('MI-07 repeated server ID skips the model, searches and new task creation', async () => {
    const h = harness();

    const first = await h.run(
      undefined,

      undefined,

      'same-request',
    );

    h.setPlan(plan(search('Adidas')));

    const duplicate = await h.run(
      'changed retry payload',

      first.workspace,

      'same-request',
    );

    expect(duplicate.workspace).toEqual(first.workspace);

    expect(h.decide).toHaveBeenCalledTimes(1);

    expect(h.service.search).toHaveBeenCalledTimes(2);

    expect(duplicate.groups).toEqual([]);
  });

  it('MI-08 searches overlap; reversed completion order cannot reorder groups or overwrite siblings', async () => {
    const h = harness();

    const release: Array<() => void> = [];

    let bothStarted!: () => void;

    const started = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });

    h.service.search.mockImplementation(
      (spec) =>
        new Promise((resolve) => {
          release.push(() => resolve(products(spec)));

          if (release.length === 2) {
            bothStarted();
          }
        }),
    );

    const pending = h.run();

    await started;

    release[1]();

    release[0]();

    const result = await pending;

    expect(result.groups.map((group) => group.query)).toEqual([
      'мужские кроссовки Nike',

      'женское платье',
    ]);

    expect(
      new Set(
        result.workspace.tasks.map(
          (task) => task.record.results.active!.resultId,
        ),
      ).size,
    ).toBe(2);

    expect(
      result.workspace.tasks.every(
        (task) => task.record.processedRequestIds.length === 1,
      ),
    ).toBe(true);
  });

  it('keeps a successful sibling when one search fails and never presents stale results as current', async () => {
    const h = harness();

    h.service.search.mockImplementation(async (spec) => {
      if (spec.category === 'CLOTHES') {
        throw new Error('offline failure');
      }

      return products(spec);
    });

    const result = await h.run();

    expect(result.groups.map((group) => group.status)).toEqual([
      'ready',

      'failed',
    ]);

    expect(result.groups[0].products).toHaveLength(3);

    expect(result.groups[1].products).toEqual([]);

    expect(result.workspace.tasks[1].record.results.lastFailure).toBeDefined();
  });

  it('validates all operations before search and rejects two writes to the same task', async () => {
    const h = harness();

    const first = await h.run();

    const refine = existing(
      'REFINE',

      {
        searchPatch: {
          set: [
            constraint(
              'price',

              10000,

              'lte',
            ),
          ],
        },
      },

      named(
        first.workspace,

        0,

        'Nike',
      ),
    );

    h.setPlan(
      plan(
        refine,

        refine,
      ),
    );

    const result = await h.run(
      'Nike до 10000',

      first.workspace,
    );

    expect(h.service.search).toHaveBeenCalledTimes(2);

    expect(result.workspace.tasks).toEqual(first.workspace.tasks);

    h.setPlan(
      plan(
        search('Adidas'),

        search(
          'невалидный товар',

          'UNKNOWN',
        ),
      ),
    );

    const invalid = await h.run(
      'Найди Adidas и неизвестный товар',

      first.workspace,
    );

    expect(invalid.workspace.tasks).toEqual(first.workspace.tasks);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('removes only the named task and replay cannot resurrect or delete another task', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan({
        kind: 'remove',

        target: named(
          first.workspace,

          1,

          'Платья',
        ),
      }),
    );

    const next = await h.run(
      'Платья больше не нужны',

      first.workspace,

      'remove-id',
    );

    expect(next.workspace.tasks).toEqual([first.workspace.tasks[0]]);

    expect(next.workspace.focus).toEqual([first.workspace.focus[0]]);

    const replay = await h.run(
      'Платья больше не нужны',

      next.workspace,

      'remove-id',
    );

    expect(replay.workspace).toEqual(next.workspace);
  });

  it('standalone new search replaces stale workspace without asking the user to manage old tasks', async () => {
    const h = harness(
      plan(
        ...['Nike', 'Adidas', 'Reebok', 'Puma', 'Asics'].map((brand) =>
          search(brand),
        ),
      ),
    );

    const first = await h.run('Найди пять брендов');

    expect(first.workspace.tasks).toHaveLength(5);

    h.setPlan(plan(search('Converse')));

    const next = await h.run(
      'Найди Converse',

      first.workspace,
    );

    expect(next.workspace.tasks).toHaveLength(1);

    expect(next.workspace.tasks[0].record.state!.search!.semanticIntent).toBe(
      'Converse',
    );

    expect(next.message).not.toContain('пять');

    expect(next.message).not.toContain('закры');

    expect(next.workspace.processedRequestIds).toEqual(
      expect.arrayContaining(first.workspace.processedRequestIds),
    );

    expect(h.service.search).toHaveBeenCalledTimes(6);
  });

  it('explicit append may extend the current workspace beyond five tasks without exposing capacity management', async () => {
    const h = harness(
      plan(
        ...['Nike', 'Adidas', 'Reebok', 'Puma', 'Asics'].map((brand) =>
          search(brand),
        ),
      ),
    );

    const first = await h.run('Найди пять брендов');

    h.setPlan(plan(search('Converse')));

    const next = await h.run(
      'А ещё Converse',

      first.workspace,
    );

    expect(next.workspace.tasks).toHaveLength(6);

    expect(next.workspace.tasks.slice(0, 5)).toEqual(first.workspace.tasks);

    expect(next.workspace.tasks[5].record.state!.search!.semanticIntent).toBe(
      'Converse',
    );

    expect(next.message).not.toContain('закры');

    expect(h.service.search).toHaveBeenCalledTimes(6);
  });

  it('a single pending question owns its answer while a sibling search is already shown', async () => {
    const question = existing(
      'CLARIFY',

      {
        taskTransition: 'start_new',

        search: {
          semanticIntent: 'платье',

          category: 'CLOTHES',

          constraints: [],
        },
      },

      {
        kind: 'new',
      },

      'платье',
    );

    question.decision.terminalText = 'Какой цвет платья?';

    const h = harness(
      plan(
        search('Nike'),

        question,
      ),
    );

    const first = await h.run('Найди Nike и подбери платье');

    h.setPlan(
      plan(
        existing(
          'REFINE',

          {
            searchPatch: {
              set: [
                constraint(
                  'color',

                  'чёрный',
                ),
              ],
            },
          },

          {
            kind: 'current',
          },

          'чёрное',
        ),
      ),
    );

    const next = await h.run(
      'чёрное',

      first.workspace,
    );

    expect(next.workspace.tasks[0]).toEqual(first.workspace.tasks[0]);

    expect(next.workspace.tasks[1].question).toBeNull();

    expect(
      next.workspace.tasks[1].record.state!.search!.constraints,
    ).toContainEqual(
      constraint(
        'color',

        'чёрный',
      ),
    );
  });

  it('recommendation and feedback use the selected task; sibling Memory is untouched', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(
        existing(
          'RECOMMEND',

          {
            selection: {
              kind: 'active',
            },
          },

          named(
            first.workspace,

            0,

            'Nike',
          ),

          'Что посоветуешь из Nike?',
        ),
      ),
    );

    const recommended = await h.run(
      'Что посоветуешь из Nike?',

      first.workspace,
    );

    expect(h.respond).toHaveBeenCalledTimes(1);

    expect(h.service.getProductSemanticRepresentations).toHaveBeenCalledTimes(
      1,
    );

    h.setPlan(
      plan(
        existing(
          'FEEDBACK',

          {
            feedback: {
              reaction: 'like',

              reason: null,

              attributeId: null,

              sourceText: 'нравится первый',

              selection: {
                kind: 'positions',

                positions: [1],
              },
            },
          },
        ),
      ),
    );

    const feedback = await h.run(
      'нравится первый',

      recommended.workspace,
    );

    expect(feedback.workspace.tasks[1]).toEqual(first.workspace.tasks[1]);

    expect(
      feedback.workspace.tasks[0].record.state!.memory.memory.feedback,
    ).toHaveLength(1);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('completes only the addressed task and can show a retained task without a new search', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(
        existing(
          'COMPLETE',

          {},

          named(
            first.workspace,

            0,

            'Nike',
          ),
        ),
      ),
    );

    const closed = await h.run(
      'С Nike закончили',

      first.workspace,
    );

    expect(closed.workspace.tasks).toEqual([first.workspace.tasks[1]]);

    h.setPlan(plan(existing('SHOW_RESULTS')));

    const shown = await h.run(
      'Покажи оставшиеся',

      closed.workspace,
    );

    expect(shown.groups[0].products).toHaveLength(3);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('explicit full-result references do not inherit narrowed comparison positions', async () => {
    const h = harness(plan(search('Nike')));

    const first = await h.run('Nike');

    h.setPlan(
      plan(
        existing(
          'COMPARE',

          {
            selection: {
              kind: 'positions',

              positions: [3, 1],
            },
          },
        ),
      ),
    );

    const compared = await h.run(
      'Сравни третий и первый',

      first.workspace,
    );

    h.setPlan(
      plan(
        existing(
          'DETAILS',

          {
            selection: {
              kind: 'positions',

              positions: [2],
            },
          },

          {
            kind: 'current',

            view: 'results',
          },
        ),
      ),
    );

    await h.run(
      'Покажи второй из найденных',

      compared.workspace,
    );

    expect(h.service.getProductDetails).toHaveBeenLastCalledWith(['Nike-2']);
  });

  it('closes all tasks only with explicit whole-consultation completion and preserves replay protection', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(
        existing(
          'COMPLETE',

          {},

          {
            kind: 'all',
          },
        ),
      ),
    );

    const ambiguous = await h.run(
      'Закончили с этим',

      first.workspace,
    );

    expect(ambiguous.workspace.tasks).toEqual(first.workspace.tasks);

    const complete = await h.run(
      'Спасибо, это всё',

      first.workspace,

      'complete-all',
    );

    expect(complete.workspace.tasks).toEqual([]);

    expect(complete.workspace.focus).toEqual([]);

    expect(complete.workspace.processedRequestIds).toContain('complete-all');

    expect(h.respond).not.toHaveBeenCalled();
  });

  it('the first search after clarification retains task Memory and generation; later SEARCH continue is rejected', async () => {
    const question = existing(
      'CLARIFY',

      {
        taskTransition: 'start_new',

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'ежедневная ходьба',

            importance: 'high',

            sourceText: 'много хожу',
          },
        ],
      },

      {
        kind: 'new',
      },
    );

    question.decision.terminalText = 'Какую обувь хотите?';

    const h = harness(plan(question));

    const first = await h.run('Много хожу, нужна обувь');

    const start = existing(
      'SEARCH',

      {
        taskTransition: 'continue',

        search: {
          semanticIntent: 'Nike',

          category: 'SHOES',

          constraints: [],
        },
      },
    );

    h.setPlan(plan(start));

    const searched = await h.run(
      'Nike',

      first.workspace,
    );

    expect(searched.workspace.tasks[0].taskId).toBe(
      first.workspace.tasks[0].taskId,
    );

    expect(searched.workspace.tasks[0].record.generation).toBe(
      first.workspace.tasks[0].record.generation,
    );

    expect(
      searched.workspace.tasks[0].record.state!.memory.memory.goals,
    ).toEqual(first.workspace.tasks[0].record.state!.memory.memory.goals);

    const rejected = await h.run(
      'Снова Nike',

      searched.workspace,
    );

    expect(rejected.groups).toEqual([]);

    expect(h.service.search).toHaveBeenCalledTimes(1);
  });

  it('a synthesis failure preserves accepted task state and does not suppress an independent result', async () => {
    const h = harness(plan(search('Nike')));

    const first = await h.run('Nike');

    h.respond.mockRejectedValueOnce(new Error('model offline'));

    h.setPlan(
      plan(
        existing(
          'RECOMMEND',

          {
            selection: {
              kind: 'active',
            },
          },
        ),

        search(
          'платье',

          'CLOTHES',
        ),
      ),
    );

    const next = await h.run(
      'Посоветуй из этих и найди платье',

      first.workspace,
    );

    expect(next.groups.map((group) => group.status)).toEqual([
      'failed',

      'ready',
    ]);

    expect(next.workspace.tasks).toHaveLength(2);

    expect(next.workspace.tasks[0].record.revision).toBeGreaterThan(
      first.workspace.tasks[0].record.revision,
    );
  });

  it('remembers an ambiguous action so answering its question does not become a new task', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(
        existing(
          'DETAILS',

          {
            selection: {
              kind: 'positions',

              positions: [2],
            },
          },
        ),
      ),
    );

    const unclear = await h.run(
      'Покажи второй подробнее',

      first.workspace,
    );

    expect(unclear.workspace.pendingClarification?.query).toBe(
      'Покажи второй подробнее',
    );

    h.setPlan(
      plan(
        existing(
          'DETAILS',

          {
            selection: {
              kind: 'positions',

              positions: [2],
            },
          },

          named(
            first.workspace,

            0,

            'Nike',
          ),

          'Покажи второй Nike подробнее',
        ),
      ),
    );

    const resolved = await h.run(
      'Nike',

      unclear.workspace,
    );

    const messages = h.decide.mock.calls.at(-1)![0] as Array<{
      content: string;
    }>;

    expect(JSON.parse(messages[1].content).pendingClarification).toMatchObject({
      query: 'Покажи второй подробнее',
    });

    expect(resolved.workspace.pendingClarification).toBeNull();

    expect(resolved.workspace.tasks).toHaveLength(2);

    expect(h.service.getProductDetails).toHaveBeenLastCalledWith([
      'мужские кроссовки Nike-2',
    ]);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('an old question cannot steal a follow-up after switching to a different task', async () => {
    const question = existing(
      'CLARIFY',

      {
        taskTransition: 'start_new',

        search: {
          semanticIntent: 'платье',

          category: 'CLOTHES',

          constraints: [],
        },
      },

      {
        kind: 'new',
      },

      'платье',
    );

    const h = harness(plan(question));

    const first = await h.run('Нужно платье');

    h.setPlan(plan(search('Nike')));

    const switched = await h.run(
      'А ещё Nike',

      first.workspace,
    );

    h.setPlan(
      plan(
        existing(
          'REFINE',

          {
            searchPatch: {
              set: [
                constraint(
                  'price',

                  10000,

                  'lte',
                ),
              ],
            },
          },
        ),
      ),
    );

    const refined = await h.run(
      'До 10000',

      switched.workspace,
    );

    expect(refined.workspace.tasks[0]).toEqual(switched.workspace.tasks[0]);

    expect(
      refined.workspace.tasks[1].record.state!.search!.constraints,
    ).toContainEqual(
      constraint(
        'price',

        10000,

        'lte',
      ),
    );
  });

  it('Evaluation target persists workspace and records independent groups without ProductNeed state', async () => {
    const h = harness();

    const target = new CurrentProductConsultationTarget(
      h.aiService,

      h.service as unknown as ProductAgentService,
    );

    const turn = {
      id: 'T1',

      messageId: 'request-eval',

      kind: 'message' as const,

      message: 'Nike и платье',
    };

    const result = await target.runTurn({
      turn,

      state: null,
    });

    expect(ProductWorkspaceSchema.parse(result.stateAfter).tasks).toHaveLength(
      2,
    );

    expect(
      result.artifacts.filter((artifact) => artifact.kind === 'search_results'),
    ).toHaveLength(2);

    const replay = await target.runTurn({
      turn,

      state: result.stateAfter,
    });

    expect(replay.stateAfter).toEqual(result.stateAfter);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('Frozen Evaluation target uses captured search and semantic data boundaries without falling through to live services', async () => {
    const h = harness(plan(pair().operations[0]));

    const fixture = await loadCurrentProductConsultationFixture(
      'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
    );

    const target = new FrozenCurrentProductConsultationTarget(
      h.aiService,

      h.service as unknown as ProductAgentService,

      fixture,
    );

    const searched = await target.runTurn({
      turn: {
        id: 'T1',

        messageId: 'frozen-search',

        kind: 'message',

        message: 'мужские кроссовки Nike',
      },

      state: null,
    });

    const workspace = ProductWorkspaceSchema.parse(searched.stateAfter);

    expect(workspace.tasks[0].record.results.active!.products).toHaveLength(3);

    expect(h.service.search).not.toHaveBeenCalled();

    expect(h.service.getProductDetails).not.toHaveBeenCalled();

    h.setPlan(
      plan(
        existing(
          'RECOMMEND',

          {
            selection: {
              kind: 'active',
            },
          },
        ),
      ),
    );

    const recommended = await target.runTurn({
      turn: {
        id: 'T2',

        messageId: 'frozen-recommend',

        kind: 'message',

        message: 'Что посоветуешь?',
      },

      state: searched.stateAfter,
    });

    expect(recommended.finalText).toBe('Рекомендация по данным каталога.');

    expect(h.service.getProductSemanticRepresentations).not.toHaveBeenCalled();
  });
});
