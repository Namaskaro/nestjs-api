import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ProductWorkspaceSchema } from './product-workspace';

import {
  action,
  constraint,
  harness,
  lane,
  named,
  newSearch,
  plan,
  positions,
  products,
} from './product-workspace.test-fixtures';

afterEach(() => jest.restoreAllMocks());

const greenSearch = () =>
  newSearch('зелёные кроссовки Nike', 'SHOES', [
    constraint('brand', 'Nike'),

    constraint('color', 'зелёные'),
  ]);

const fromComparison = (name = 'RECOMMEND') =>
  action(
    name,
    {
      selection: {
        kind: 'active',
      },
    },
    'comparison',
  );

describe('Product multi-action correction cases', () => {
  it('stops SEARCH → zero → DETAILS at recovery, keeps the accepted record and lets a sibling finish', async () => {
    const search = greenSearch();

    const h = harness(
      plan(
        {
          ...search,

          actions: [...search.actions, action('DETAILS', positions(2))],
        },
        newSearch('платье', 'CLOTHES'),
      ),
    );

    h.service.search.mockImplementation(async (spec) =>
      spec.constraints.length === 2 ? [] : products(spec),
    );

    const result = await h.run(
      'Найди зелёные Nike, покажи второй подробнее и найди платье',
    );

    expect(result.groups.map((group) => group.status)).toEqual([
      'empty',
      'ready',
    ]);

    expect(result.groups[0].recovery!.options).toHaveLength(2);

    expect(result.workspace.tasks[0].question).toBe(
      result.groups[0].recovery!.question,
    );

    expect(result.workspace.tasks[0].record.results.active!.products).toEqual(
      [],
    );

    expect(
      result.workspace.tasks[0].record.state!.search!.constraints,
    ).toHaveLength(2);

    expect(result.workspace.tasks[0].record.processedRequestIds).toHaveLength(
      1,
    );

    expect(result.groups[0].presentations).toEqual([]);

    expect(result.groups[1].products).toHaveLength(3);

    expect(
      h.service.getProductDetails.mock.calls.every(([ids]) =>
        ids.every((id) => id.startsWith('платье')),
      ),
    ).toBe(true);

    expect(result.message).toContain(result.groups[0].recovery!.question);

    expect(h.respond).not.toHaveBeenCalled();
  });

  it('stops REFINE → zero → COMPARE at recovery and continues with an ordinary REFINE next turn', async () => {
    const h = harness(
      plan(newSearch('кроссовки Nike', 'SHOES', [constraint('brand', 'Nike')])),
    );

    const first = await h.run();

    h.service.getProductDetails.mockClear();

    h.service.search.mockImplementation(async (spec) =>
      spec.constraints.length === 2 ? [] : products(spec),
    );

    h.setPlan(
      plan(
        lane('Только зелёные и сравни первые два', [
          action('REFINE', {
            searchPatch: {
              semanticIntent: 'зелёные кроссовки Nike',

              set: [constraint('color', 'зелёные')],

              clear: [],
            },
          }),

          action('COMPARE', positions(1, 2)),
        ]),
      ),
    );

    const zero = await h.run(
      'Только зелёные и сравни первые два',
      first.workspace,
    );

    expect(zero.groups[0].status).toBe('empty');

    expect(zero.groups[0].recovery!.options).toHaveLength(2);

    expect(zero.workspace.tasks[0].question).toBe(
      zero.groups[0].recovery!.question,
    );

    expect(zero.workspace.tasks[0].record.processedRequestIds).toHaveLength(2);

    expect(h.service.getProductDetails).not.toHaveBeenCalled();

    h.setPlan(
      plan(
        lane('Бренд важнее', [
          action('REFINE', {
            searchPatch: {
              semanticIntent: 'кроссовки Nike',

              set: [],

              clear: [
                {
                  attributeId: 'color',

                  operator: 'eq',
                },
              ],
            },
          }),
        ]),
      ),
    );

    const resumed = await h.run('Бренд важнее', zero.workspace);

    expect(resumed.groups[0].status).toBe('ready');

    expect(resumed.workspace.tasks[0].taskId).toBe(
      first.workspace.tasks[0].taskId,
    );

    expect(resumed.workspace.tasks[0].question).toBeNull();
  });

  it('keeps the last comparison after DETAILS for a later recommendation, separately from ordinary focus', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(lane('Сравни первые два', [action('COMPARE', positions(1, 2))])),
    );

    const compared = await h.run('Сравни первые два', first.workspace);

    h.setPlan(
      plan(lane('Покажи третий подробнее', [action('DETAILS', positions(3))])),
    );

    const detailed = await h.run('Покажи третий подробнее', compared.workspace);

    expect(detailed.workspace.tasks[0].lastComparison).toEqual({
      resultId: first.workspace.tasks[0].record.results.active!.resultId,

      positions: [1, 2],
    });

    expect(detailed.workspace.focus[0].positions).toEqual([3]);

    h.service.getProductDetails.mockClear();

    h.setPlan(
      plan(
        lane('Из тех двух, что сравнивали', [fromComparison()], {
          kind: 'current',

          view: 'comparison',
        }),
      ),
    );

    const result = await h.run(
      'Какой из тех двух, что сравнивали, ты посоветуешь?',
      detailed.workspace,
    );

    expect(h.service.getProductDetails).toHaveBeenCalledWith([
      'кроссовки-1',
      'кроссовки-2',
    ]);

    expect(h.service.getProductSemanticRepresentations).toHaveBeenCalledWith([
      'кроссовки-1',
      'кроссовки-2',
    ]);

    expect(result.groups[0].presentations![0]).toMatchObject({
      kind: 'recommendation',

      productIds: ['кроссовки-1'],
    });

    expect(h.service.search).toHaveBeenCalledTimes(1);

    const context = JSON.parse(
      (
        h.decide.mock.calls.at(-1)![0] as Array<{
          content: string;
        }>
      )[1].content,
    );

    expect(context.tasks[0].lastComparison).toEqual({
      positions: [1, 2],
    });
  });

  it('supports same-turn COMPARE → DETAILS → RECOMMEND from comparison in original comparison order', async () => {
    const h = harness();

    const first = await h.run();

    h.service.getProductDetails.mockClear();

    h.setPlan(
      plan(
        lane('Сравни, покажи третий и посоветуй из сравниваемых', [
          action('COMPARE', positions(2, 1)),

          action('DETAILS', positions(3)),

          fromComparison(),
        ]),
      ),
    );

    const result = await h.run(
      'Сравни первые два, покажи третий, посоветуй из сравниваемых',
      first.workspace,
    );

    expect(result.groups[0].status).toBe('ready');

    expect(
      result.groups[0].presentations!.map((presentation) => presentation.kind),
    ).toEqual(['comparison', 'details', 'recommendation']);

    expect(h.service.getProductDetails.mock.calls.map(([ids]) => ids)).toEqual([
      ['кроссовки-2', 'кроссовки-1'],
      ['кроссовки-3'],
      ['кроссовки-2', 'кроссовки-1'],
    ]);

    expect(result.workspace.tasks[0].lastComparison!.positions).toEqual([2, 1]);

    expect(h.service.search).toHaveBeenCalledTimes(1);
  });

  it('invalidates comparison on a new snapshot and refuses a missing or stale comparison reference', async () => {
    const h = harness();

    const first = await h.run();

    h.setPlan(
      plan(lane('Сравни первые два', [action('COMPARE', positions(1, 2))])),
    );

    const compared = await h.run('Сравни первые два', first.workspace);

    h.setPlan(
      plan(
        lane('До 2000', [
          action('REFINE', {
            searchPatch: {
              set: [constraint('price', 2000, 'lte')],

              clear: [],
            },
          }),
        ]),
      ),
    );

    const refined = await h.run('Только до 2000', compared.workspace);

    expect(refined.workspace.tasks[0].lastComparison).toBeUndefined();

    const stale = structuredClone(refined.workspace);

    stale.tasks[0].lastComparison = compared.workspace.tasks[0].lastComparison;

    expect(ProductWorkspaceSchema.safeParse(stale).success).toBe(false);

    h.service.getProductDetails.mockClear();

    h.setPlan(plan(lane('Из сравниваемых', [fromComparison()])));

    const result = await h.run('Посоветуй из сравниваемых', refined.workspace);

    expect(result.workspace.pendingClarification).not.toBeNull();

    expect(result.workspace.tasks).toEqual(refined.workspace.tasks);

    expect(h.service.getProductDetails).not.toHaveBeenCalled();

    expect(h.respond).not.toHaveBeenCalled();
  });

  it('clarifies multiple comparison owners and resolves an explicit task position in comparison order', async () => {
    const h = harness(
      plan(newSearch('кроссовки'), newSearch('ботинки', 'SHOES')),
    );

    const first = await h.run('Найди кроссовки и ботинки');

    h.setPlan(
      plan(
        lane(
          'Сравни кроссовки',
          [action('COMPARE', positions(2, 1))],
          named(first.workspace, 0, 'кроссовки'),
        ),

        lane(
          'Сравни ботинки',
          [action('COMPARE', positions(1, 2))],
          named(first.workspace, 1, 'ботинки'),
        ),
      ),
    );

    const compared = await h.run('Сравни кроссовки и ботинки', first.workspace);

    h.setPlan(
      plan(
        lane(
          'Подробности ботинок',
          [action('DETAILS', positions(3))],
          named(compared.workspace, 1, 'ботинки'),
        ),
      ),
    );

    const detailed = await h.run(
      'Покажи ботинки подробнее',
      compared.workspace,
    );

    h.service.getProductDetails.mockClear();

    h.setPlan(plan(lane('Из тех, что сравнивали', [fromComparison()])));

    const ambiguous = await h.run(
      'Посоветуй из тех, что сравнивали',
      detailed.workspace,
    );

    expect(ambiguous.workspace.pendingClarification).not.toBeNull();

    expect(h.service.getProductDetails).not.toHaveBeenCalled();

    h.setPlan(
      plan(
        lane('Кроссовки, второй из сравниваемых', [
          action('RECOMMEND', positions(2), 'comparison'),
        ]),
      ),
    );

    const explicit = await h.run(
      'Кроссовки, второй из сравниваемых',
      ambiguous.workspace,
    );

    expect(h.service.getProductDetails).toHaveBeenCalledWith(['кроссовки-1']);

    expect(explicit.workspace.tasks[1]).toEqual(detailed.workspace.tasks[1]);

    expect(h.service.search).toHaveBeenCalledTimes(2);
  });

  it('resolves explicit comparison references per task and does not replace them after failed COMPARE', async () => {
    const h = harness(
      plan(newSearch('кроссовки'), newSearch('платье', 'CLOTHES')),
    );

    const first = await h.run('Найди кроссовки и платье');

    h.setPlan(
      plan(
        lane(
          'Сравни кроссовки',
          [action('COMPARE', positions(1, 2))],
          named(first.workspace, 0, 'кроссовки'),
        ),
      ),
    );

    const compared = await h.run('Сравни кроссовки', first.workspace);

    h.setPlan(
      plan(
        lane(
          'Подробности платья',
          [action('DETAILS', positions(3))],
          named(compared.workspace, 1, 'платье'),
        ),
      ),
    );

    const dress = await h.run('Покажи платье подробнее', compared.workspace);

    h.service.getProductDetails.mockClear();

    h.setPlan(
      plan(
        lane('Повтори сравнение тех двух', [fromComparison('COMPARE')], {
          kind: 'current',

          view: 'comparison',
        }),
      ),
    );

    const repeated = await h.run(
      'Сравни ещё раз те два, которые сравнивали',
      dress.workspace,
    );

    expect(h.service.getProductDetails).toHaveBeenCalledWith([
      'кроссовки-1',
      'кроссовки-2',
    ]);

    expect(repeated.workspace.tasks[1]).toEqual(dress.workspace.tasks[1]);

    h.setPlan(
      plan(lane('Сравни другие', [action('COMPARE', positions(2, 3))])),
    );

    h.service.getProductDetails.mockRejectedValueOnce(
      new Error('catalog unavailable'),
    );

    const failed = await h.run(
      'Сравни второй и третий кроссовки',
      repeated.workspace,
    );

    expect(failed.groups[0].status).toBe('failed');

    expect(failed.workspace.tasks[0].lastComparison).toEqual(
      repeated.workspace.tasks[0].lastComparison,
    );
  });
});
