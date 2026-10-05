import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConsultationWriteOwner } from '../runtime/consultation-write-owner';
import { CategoryProfileSchema } from '../../core/consultation-core.schema';
import { SHOES_PROFILE } from '../../core/profiles';
import { SearchSpecSchema } from '../../core/search/search-spec.schema';
import { zeroResultCandidates } from './zero-result-recovery';
import {
  action,
  constraint,
  deferred,
  harness,
  lane,
  newSearch,
  plan,
  products,
} from '../workspace/product-workspace.test-fixtures';

afterEach(() => jest.restoreAllMocks());

export const greenNikePlan = () =>
  plan(
    newSearch('зелёные мужские кроссовки Nike', 'SHOES', [
      constraint('gender', 'MAN'),
      constraint('brand', 'Nike'),
      constraint('color', 'зелёные'),
    ]),
  );

describe('grounded zero-result recovery', () => {
  it('probes independent relaxations concurrently and proposes only actual hits without changing the accepted search', async () => {
    const h = harness(greenNikePlan());
    const writes = jest.spyOn(ConsultationWriteOwner.prototype, 'execute');
    const started = deferred();
    const gates = [deferred(), deferred()];
    let probes = 0;
    h.service.search.mockImplementation(async (spec) => {
      if (spec.constraints.length === 3) return [];
      const index = probes++;
      if (probes === 2) started.resolve();
      await gates[index].promise;
      return products(spec);
    });
    const running = h.run(
      'Найди зелёные мужские кроссовки Nike',
      undefined,
      'zero-turn',
    );
    await started.promise;
    expect(h.service.search).toHaveBeenCalledTimes(3);
    gates[1].resolve();
    gates[0].resolve();
    const result = await running;
    expect(
      result.groups[0].recovery?.options.map((o) => o.clear.attributeId),
    ).toEqual(['color', 'brand']);
    expect(result.groups[0].products).toEqual([]);
    const record = result.workspace.tasks[0].record;
    expect(record.state!.search!.constraints).toHaveLength(3);
    expect(record.state!.search!.semanticIntent).toBe(
      'зелёные мужские кроссовки Nike',
    );
    expect(record.results.active!.products).toEqual([]);
    expect(record.results.lastConfirmed!.products).toEqual([]);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(result.workspace.tasks[0].question).toBe(
      result.groups[0].recovery?.question,
    );
    expect(h.respond).not.toHaveBeenCalled();
    const probed = h.service.search.mock.calls.slice(1).map(([spec]) => spec);
    expect(probed.map((spec) => spec.semanticIntent)).toEqual([
      'мужские кроссовки Nike',
      'зелёные мужские кроссовки',
    ]);
    expect(
      probed.every(
        (spec) =>
          spec.category === 'SHOES' &&
          spec.constraints.some(
            (c) => c.attributeId === 'gender' && c.value === 'MAN',
          ),
      ),
    ).toBe(true);
    const replay = await h.run('тот же запрос', result.workspace, 'zero-turn');
    expect(replay.groups).toEqual([]);
    expect(h.service.search).toHaveBeenCalledTimes(3);
    expect(h.decide).toHaveBeenCalledTimes(1);
  });

  it.each(['empty', 'failure'] as const)(
    'omits a candidate with %s and keeps a successful sibling probe',
    async (outcome) => {
      const h = harness(greenNikePlan());
      h.service.search.mockImplementation(async (spec) => {
        if (spec.constraints.length === 3) return [];
        if (!spec.constraints.some((c) => c.attributeId === 'color')) {
          if (outcome === 'failure') throw new Error('search unavailable');
          return [];
        }
        return products(spec);
      });
      const result = await h.run();
      expect(result.groups[0].status).toBe('empty');
      expect(
        result.groups[0].recovery?.options.map((o) => o.clear.attributeId),
      ).toEqual(['brand']);
      expect(result.message).not.toContain('Цвет =');
      expect(result.message).toContain('Бренд = Nike');
    },
  );

  it('does not invent alternatives if all probes are empty; other task results survive', async () => {
    const h = harness(
      plan(...greenNikePlan().operations, newSearch('платье', 'CLOTHES')),
    );
    h.service.search.mockImplementation(async (spec) =>
      spec.category === 'CLOTHES' ? products(spec) : [],
    );
    const result = await h.run('Найди зелёные Nike и платье');
    expect(result.groups[0].recovery?.options).toEqual([]);
    expect(result.groups[1].products).toHaveLength(3);
    expect(result.message).toContain('Подтверждённых вариантов');
    expect(result.message).toContain('платье');
  });

  it('applies only the chosen relaxation in a later REFINE and retains task identity', async () => {
    const h = harness(greenNikePlan());
    h.service.search.mockImplementation(async (spec) =>
      spec.constraints.length === 3 ? [] : products(spec),
    );
    const zero = await h.run();
    const before = structuredClone(zero.workspace.tasks[0]);
    h.service.search.mockClear();
    h.setPlan(
      plan(
        lane('Бренд важнее', [
          action('REFINE', {
            searchPatch: {
              clear: [{ attributeId: 'color', operator: 'eq' }],
              set: [],
              semanticIntent: 'мужские кроссовки Nike',
            },
          }),
        ]),
      ),
    );
    const chosen = await h.run('Бренд важнее', zero.workspace);
    expect(chosen.workspace.tasks[0].taskId).toBe(before.taskId);
    expect(chosen.workspace.tasks[0].record.state!.search!.constraints).toEqual(
      before.record.state!.search!.constraints.filter(
        (c) => c.attributeId !== 'color',
      ),
    );
    expect(chosen.workspace.tasks[0].question).toBeNull();
    expect(chosen.groups[0].products).toHaveLength(3);
    expect(h.service.search).toHaveBeenCalledTimes(1);
    expect(zero.workspace.tasks[0]).toEqual(before);
  });

  it('uses profile policy generically, excludes critical attributes and bounds diagnostics instead of exploring combinations', () => {
    const profile = CategoryProfileSchema.parse({
      ...SHOES_PROFILE,
      searchRelaxationAttributeIds: [
        'sizes',
        'material',
        'price',
        'brand',
        'color',
      ],
    });
    const search = SearchSpecSchema.parse({
      version: 1,
      category: 'SHOES',
      semanticIntent: 'походные ботинки',
      constraints: [
        constraint('sizes', '42', 'contains'),
        constraint('material', 'кожа'),
        constraint('price', 1000, 'gte'),
        constraint('price', 5000, 'lte'),
        constraint('brand', 'Nike'),
        constraint('color', 'green'),
      ],
    });
    const candidates = zeroResultCandidates(search, profile, {
      validate: () => undefined,
    });
    expect(candidates.map((c) => c.option.clear)).toEqual([
      { attributeId: 'material', operator: 'eq' },
      { attributeId: 'price', operator: 'gte' },
      { attributeId: 'price', operator: 'lte' },
    ]);
    expect(
      candidates.every(
        (c) =>
          c.search.constraints.length === search.constraints.length - 1 &&
          c.search.constraints.some((v) => v.attributeId === 'sizes'),
      ),
    ).toBe(true);
  });

  it('skips adapter-rejected candidates before I/O and never broadens an intent to an arbitrary category query', () => {
    const spec = SearchSpecSchema.parse({
      version: 1,
      category: 'SHOES',
      semanticIntent: 'Nike',
      constraints: [constraint('brand', 'Nike')],
    });
    const validate = jest.fn();
    expect(zeroResultCandidates(spec, SHOES_PROFILE, { validate })).toEqual([]);
    expect(validate).not.toHaveBeenCalled();
    expect(
      zeroResultCandidates(
        { ...spec, semanticIntent: 'кроссовки Nike' },
        SHOES_PROFILE,
        {
          validate: () => {
            throw new Error('unsupported');
          },
        },
      ),
    ).toEqual([]);
  });
});
