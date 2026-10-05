import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConsultationWriteOwner } from '../runtime/consultation-write-owner';
import { productActionRequestId } from './product-workspace-plan';
import {
  action,
  constraint,
  deferred,
  details,
  harness,
  lane,
  named,
  newSearch,
  plan,
  positions,
  products,
} from './product-workspace.test-fixtures';

afterEach(() => jest.restoreAllMocks());

describe('Product ordered action lanes: real graph and offline model', () => {
  it('starts three isolated searches before any completes and preserves request order on reverse completion', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки', 'SHOES', [constraint('gender', 'MAN')]),
        newSearch('платье', 'CLOTHES', [constraint('gender', 'WOMAN')]),
        newSearch('детские шорты', 'CLOTHES'),
      ),
    );
    const gates = [deferred(), deferred(), deferred()];
    const started = deferred();
    let calls = 0;
    h.service.search.mockImplementation(async (spec) => {
      const index = calls++;
      if (calls === 3) started.resolve();
      await gates[index].promise;
      return products(spec);
    });
    const running = h.run('Найди кроссовки, платье и шорты');
    await started.promise;
    expect(h.service.search).toHaveBeenCalledTimes(3);
    gates[2].resolve();
    gates[1].resolve();
    gates[0].resolve();
    const result = await running;
    expect(result.groups.map((g) => g.query)).toEqual([
      'кроссовки',
      'платье',
      'детские шорты',
    ]);
    expect(
      result.workspace.tasks.map((t) =>
        t.record.state!.search!.constraints.map((c) => c.value),
      ),
    ).toEqual([['MAN'], ['WOMAN'], []]);
    expect(h.decide).toHaveBeenCalledTimes(1);
    expect(h.respond).not.toHaveBeenCalled();
  });

  it('runs sibling lanes in parallel and two DETAILS of shorts strictly sequentially with the updated revision', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки'),
        newSearch('платье', 'CLOTHES'),
        newSearch('шорты', 'CLOTHES'),
      ),
    );
    const first = await h.run('Найди кроссовки, платье и шорты');
    h.service.getProductDetails.mockClear();
    h.setPlan(
      plan(
        lane(
          'Сравни кроссовки',
          [action('COMPARE', positions(1, 2))],
          named(first.workspace, 0, 'кроссовки'),
        ),
        lane(
          'Подробности платья',
          [action('DETAILS', positions(3))],
          named(first.workspace, 1, 'платье'),
        ),
        lane(
          'Подробности шорт',
          [action('DETAILS', positions(2)), action('DETAILS', positions(3))],
          named(first.workspace, 2, 'шорты'),
        ),
      ),
    );
    const writes = jest.spyOn(ConsultationWriteOwner.prototype, 'execute');
    const release = deferred();
    const started = deferred();
    let starts = 0;
    h.service.getProductDetails.mockImplementation(async (ids) => {
      starts++;
      if (starts === 3) started.resolve();
      if (ids[0] === 'шорты-2') await release.promise;
      return ids.map(details);
    });
    const running = h.run(
      'Сравни кроссовки, покажи платье и шорты подробнее',
      first.workspace,
    );
    await started.promise;
    expect(
      h.service.getProductDetails.mock.calls.map(([ids]) => ids),
    ).not.toContainEqual(['шорты-3']);
    release.resolve();
    const result = await running;
    expect(result.groups.map((g) => g.query)).toEqual([
      'кроссовки',
      'платье',
      'шорты',
    ]);
    expect(h.service.getProductDetails.mock.calls.map(([ids]) => ids)).toEqual([
      ['кроссовки-1', 'кроссовки-2'],
      ['платье-3'],
      ['шорты-2'],
      ['шорты-3'],
    ]);
    const shortsWrites = writes.mock.calls
      .map(([input]) => input)
      .filter((input) =>
        input.conversationId.endsWith(first.workspace.tasks[2].taskId),
      );
    expect(shortsWrites).toHaveLength(2);
    expect(result.groups[2].presentations?.map((p) => p.kind)).toEqual([
      'details',
      'details',
    ]);
    expect(
      result.groups[2].presentations?.map((p) =>
        p.kind === 'details' ? p.data.product.id : null,
      ),
    ).toEqual(['шорты-2', 'шорты-3']);
    expect(shortsWrites[1].expectedRevision).toBeGreaterThan(
      shortsWrites[0].expectedRevision,
    );
    expect(result.workspace.tasks[2].record.revision).toBeGreaterThan(
      shortsWrites[1].expectedRevision,
    );
  });

  it('uses stable distinct child IDs and skips the entire replay before planning or capabilities', async () => {
    const h = harness();
    const first = await h.run();
    h.service.getProductDetails.mockClear();
    h.setPlan(
      plan(
        lane('Подробности и сравнение', [
          action('DETAILS', positions(2)),
          action('DETAILS', positions(3)),
          action('COMPARE', positions(1, 3)),
        ]),
      ),
    );
    const writes = jest.spyOn(ConsultationWriteOwner.prototype, 'execute');
    const result = await h.run(
      'Покажи второй и третий, сравни первый и третий',
      first.workspace,
      'same-parent',
    );
    const ids = writes.mock.calls.map(([input]) => input.requestId);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(
      [0, 1, 2].map((index) =>
        productActionRequestId(
          'same-parent',
          first.workspace.tasks[0].taskId,
          index,
        ),
      ),
    );
    expect(result.workspace.tasks[0].record.processedRequestIds).toEqual(
      expect.arrayContaining(ids),
    );
    const replay = await h.run(
      'Покажи второй и третий, сравни первый и третий',
      result.workspace,
      'same-parent',
    );
    expect(replay.workspace).toEqual(result.workspace);
    expect(replay.groups).toEqual([]);
    expect(writes).toHaveBeenCalledTimes(3);
    expect(h.service.getProductDetails).toHaveBeenCalledTimes(3);
    expect(h.service.search).toHaveBeenCalledTimes(1);
    expect(h.decide).toHaveBeenCalledTimes(2);
  });

  it('resolves DETAILS against the new result after REFINE instead of pre-binding the old snapshot', async () => {
    const h = harness();
    const first = await h.run();
    h.setPlan(
      plan(
        lane('Уточни цену и покажи второй', [
          action('REFINE', {
            searchPatch: { set: [constraint('price', 2000, 'lte')], clear: [] },
          }),
          action('DETAILS', positions(2)),
        ]),
      ),
    );
    h.service.search.mockResolvedValue(
      products(first.workspace.tasks[0].record.state!.search!).map((p) => ({
        ...p,
        productId: `new-${p.productId}`,
      })),
    );
    const result = await h.run('До 2000 и подробнее второй', first.workspace);
    expect(h.service.getProductDetails).toHaveBeenCalledWith([
      'new-кроссовки-2',
    ]);
    expect(result.groups[0].status).toBe('ready');
  });

  it('supports a new SEARCH followed by DETAILS in one lane', async () => {
    const search = newSearch('кроссовки');
    search.actions.push(action('DETAILS', positions(2)));
    const h = harness(plan(search));
    const result = await h.run('Найди кроссовки и покажи второй');
    expect(result.workspace.tasks).toHaveLength(1);
    expect(h.service.search).toHaveBeenCalledTimes(1);
    expect(h.service.getProductDetails).toHaveBeenCalledWith(['кроссовки-2']);
  });

  it('stops a failed lane, preserves its accepted actions and delivers successful siblings', async () => {
    const h = harness(
      plan(newSearch('кроссовки'), newSearch('платье', 'CLOTHES')),
    );
    const first = await h.run('кроссовки и платье');
    h.setPlan(
      plan(
        lane(
          'кроссовки',
          [
            action('DETAILS', positions(1)),
            action('DETAILS', positions(2)),
            action('DETAILS', positions(3)),
          ],
          named(first.workspace, 0, 'кроссовки'),
        ),
        lane(
          'платье',
          [action('DETAILS', positions(2))],
          named(first.workspace, 1, 'платье'),
        ),
      ),
    );
    h.service.getProductDetails.mockImplementation(async (ids) => {
      if (ids[0] === 'кроссовки-2') throw new Error('offline failure');
      return ids.map(details);
    });
    const result = await h.run(
      'Подробности кроссовки и платье',
      first.workspace,
    );
    expect(result.groups.map((g) => g.status)).toEqual(['failed', 'ready']);
    expect(result.groups[0].presentations).toHaveLength(1);
    expect(result.groups[1].presentations).toHaveLength(1);
    expect(
      h.service.getProductDetails.mock.calls.map(([ids]) => ids),
    ).not.toContainEqual(['кроссовки-3']);
    expect(result.workspace.tasks[0].record.revision).toBeGreaterThan(
      first.workspace.tasks[0].record.revision,
    );
    expect(result.workspace.tasks[0].record.processedRequestIds).toContain(
      productActionRequestId('turn-2', first.workspace.tasks[0].taskId, 0),
    );
  });

  it('validates an obviously invalid dependent DETAILS before executing any lane', async () => {
    const h = harness();
    const first = await h.run();
    h.service.getProductDetails.mockClear();
    h.setPlan(
      plan(
        newSearch('платье', 'CLOTHES'),
        lane('кроссовки', [
          action('REFINE', {
            searchPatch: { set: [constraint('price', 2000, 'lte')], clear: [] },
          }),
          action('DETAILS', positions(1, 2)),
        ]),
      ),
    );
    const result = await h.run(
      'Найди платье и уточни кроссовки',
      first.workspace,
    );
    expect(result.workspace.tasks).toEqual(first.workspace.tasks);
    expect(h.service.search).toHaveBeenCalledTimes(1);
    expect(h.service.getProductDetails).not.toHaveBeenCalled();
    expect(result.workspace.pendingClarification).not.toBeNull();
  });

  it('grounds same-turn COMPARE then RECOMMEND in comparison order without searching again', async () => {
    const h = harness();
    const first = await h.run();
    h.service.getProductDetails.mockClear();
    h.setPlan(
      plan(
        lane('Сравни и посоветуй из них', [
          action('COMPARE', positions(3, 1)),
          action('RECOMMEND', { selection: { kind: 'active' } }, 'focus'),
        ]),
      ),
    );
    const result = await h.run(
      'Сравни третий и первый, потом посоветуй из них',
      first.workspace,
    );
    expect(h.service.getProductDetails.mock.calls.map(([ids]) => ids)).toEqual([
      ['кроссовки-3', 'кроссовки-1'],
      ['кроссовки-3', 'кроссовки-1'],
    ]);
    expect(h.service.getProductSemanticRepresentations).toHaveBeenCalledWith([
      'кроссовки-3',
      'кроссовки-1',
    ]);
    expect(h.respond).toHaveBeenCalledTimes(1);
    expect(h.service.search).toHaveBeenCalledTimes(1);
    expect(result.workspace.focus[0].positions).toEqual([3, 1]);
    expect(result.groups[0].presentations?.map((p) => p.kind)).toEqual([
      'comparison',
      'recommendation',
    ]);
    expect(result.groups[0].presentations?.[1]).toMatchObject({
      kind: 'recommendation',
      productIds: ['кроссовки-3', 'кроссовки-1'],
    });
  });

  it('preserves COMPARE then DETAILS presentations in action order', async () => {
    const h = harness();
    const first = await h.run();
    h.setPlan(
      plan(
        lane('Сравни и покажи подробнее', [
          action('COMPARE', positions(1, 2)),
          action('DETAILS', positions(3)),
        ]),
      ),
    );
    const result = await h.run(
      'Сравни первый и второй, покажи третий',
      first.workspace,
    );
    expect(
      result.groups[0].presentations?.map((p) => [p.actionOrdinal, p.kind]),
    ).toEqual([
      [0, 'comparison'],
      [1, 'details'],
    ]);
    expect(result.groups[0].presentations?.[1]).toMatchObject({
      kind: 'details',
      data: { product: { id: 'кроссовки-3' } },
    });
    expect(result.consultation).toBeNull();
    expect(result.groups[0].consultation).toBeNull();
    expect(h.respond).not.toHaveBeenCalled();
  });

  it('continues RECOMMEND after a comparison turn in the sneakers focus while preserving other tasks', async () => {
    const h = harness(
      plan(newSearch('кроссовки'), newSearch('платье', 'CLOTHES')),
    );
    const first = await h.run('кроссовки и платье');
    h.setPlan(
      plan(
        lane(
          'Сравни кроссовки',
          [action('COMPARE', positions(3, 1))],
          named(first.workspace, 0, 'кроссовки'),
        ),
      ),
    );
    const compared = await h.run(
      'Сравни третий и первый из кроссовок',
      first.workspace,
    );
    h.service.getProductDetails.mockClear();
    h.setPlan(
      plan(
        lane(
          'Какие из них посоветуешь?',
          [action('RECOMMEND', { selection: { kind: 'active' } })],
          { kind: 'current', view: 'focus' },
        ),
      ),
    );
    const result = await h.run('Какие из них посоветуешь?', compared.workspace);
    expect(h.service.getProductDetails).toHaveBeenCalledWith([
      'кроссовки-3',
      'кроссовки-1',
    ]);
    expect(h.service.getProductSemanticRepresentations).toHaveBeenCalledWith([
      'кроссовки-3',
      'кроссовки-1',
    ]);
    expect(h.service.search).toHaveBeenCalledTimes(2);
    expect(result.workspace.tasks[1]).toEqual(first.workspace.tasks[1]);
    expect(result.groups[0].taskId).toBe(first.workspace.tasks[0].taskId);
    expect(result.groups[0].presentations?.[0].kind).toBe('recommendation');
  });
});
