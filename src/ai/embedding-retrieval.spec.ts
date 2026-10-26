import {
  retrieveWithEmbeddingFallback,
  writeEmbeddingIndices,
  EmbeddingIndexIncompleteError,
} from './embedding-retrieval';
import { EmbeddingRequestError, embeddingSpace } from './embedding-execution';
import {
  indexVersionFilter,
  QdrantService,
} from '../core/qdrant/qdrant.service';

const versions = [{ id: 'a', version: 'v2' }];
const filter = { must: [{ key: 'gender', match: { value: 'female' } }] };
const spec = (provider: 'yandex' | 'openai') => ({
  provider,
  queryModel: provider + '-q',
  documentModel: provider + '-d',
  dimensions: provider === 'yandex' ? 768 : 1536,
});

describe('Qwen/Polza secondary uses the existing guarded retrieval and writer', () => {
  const polza = () => {
    const fixture = setup();
    fixture.ai.embeddingFallbackProvider = 'qwen';
    fixture.ai.secondaryEmbeddingCollection = c => `${c}_fallback`;
    fixture.ai.getEmbeddingSpec = p => p === 'qwen'
      ? { provider: p, queryModel: 'qwen/qwen3-embedding-4b', documentModel: 'qwen/qwen3-embedding-4b', dimensions: 2560, service: 'polza' }
      : spec(p);
    return fixture;
  };
  it('healthy primary never checks or calls Qwen', async () => {
    const { ai, q, run } = polza();
    await run();
    expect(ai.createEmbedding.mock.calls.map(c => c[1])).toEqual(['yandex']);
    expect(q.validateEmbeddingCollection).toHaveBeenCalledTimes(1);
    expect(q.hybridSearch.mock.calls[0][0]).toBe('products');
  });
  it('Yandex -> Qwen preserves filters and current source versions', async () => {
    const { ai, q, run } = polza();
    ai.createEmbedding.mockRejectedValueOnce(outage());
    await run();
    expect(ai.createEmbedding.mock.calls.map(c => c[1])).toEqual(['yandex', 'qwen']);
    expect(q.hybridSearch).toHaveBeenCalledWith('products_fallback', [1, 2], 'shoes', 20, {
      must: [filter, indexVersionFilter(versions, embeddingSpace(ai.getEmbeddingSpec('qwen')))],
    });
  });
  it('two availability failures use primary BM25; authentication/data errors do not', async () => {
    const { ai, q, run } = polza();
    ai.createEmbedding.mockRejectedValue(outage());
    await run();
    expect(q.keywordSearch).toHaveBeenCalledWith('products', 'shoes', 20, { must: [filter, indexVersionFilter(versions)] });
    for (const category of ['configuration', 'invalid-response'] as const) {
      const next = polza();
      const failure = new EmbeddingRequestError(category, 'qwen', 401);
      next.ai.createEmbedding.mockRejectedValueOnce(outage()).mockRejectedValueOnce(failure);
      await expect(next.run()).rejects.toBe(failure);
      expect(next.q.keywordSearch).not.toHaveBeenCalled();
    }
  });
  it('incomplete Qwen space is not queried and incompatible dimensions propagate', async () => {
    const { ai, q, run } = polza();
    ai.createEmbedding.mockRejectedValue(outage());
    q.embeddingIndexComplete.mockImplementation(async (collection, _versions, space) => collection === 'products' || !space);
    await run();
    expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
    expect(q.keywordSearch).toHaveBeenCalledTimes(1);
    const next = polza();
    next.ai.createEmbedding.mockRejectedValueOnce(outage());
    next.q.validateEmbeddingCollection.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('incompatible dimensions'));
    await expect(next.run()).rejects.toThrow('incompatible dimensions');
    expect(next.q.keywordSearch).not.toHaveBeenCalled();
  });
  it.each(['products', 'store_knowledge'])('secondary-only %s writes Qwen dense + sparse metadata without primary vectors or PG writes', async collection => {
    const { ai, q } = polza();
    const savePrimary = jest.fn();
    await writeEmbeddingIndices(ai, q, { collection, id: 'a', version: 'v2', text: 'search text', payload: {}, secondaryOnly: true, savePrimary });
    expect(ai.createEmbedding.mock.calls.map(c => c[1])).toEqual(['qwen']);
    expect(savePrimary).not.toHaveBeenCalled();
    expect(q.savePoint.mock.calls.map(c => c[0])).toEqual([`${collection}_fallback`, `${collection}_fallback`]);
    expect(q.savePoint.mock.calls[1][1]).toMatchObject({ vector: { dense: [1, 2], bm25: { text: 'search text' } }, payload: {
      _source_version: 'v2', _embedding_space: embeddingSpace(ai.getEmbeddingSpec('qwen')),
      _embedding_model: 'qwen/qwen3-embedding-4b', _embedding_dimensions: 2560, _embedding_service: 'polza',
    } });
  });
});
const outage = () => new EmbeddingRequestError('availability', 'yandex', 503);
function setup() {
  const ai: any = {
    embeddingFailover: true,
    embeddingFallbackProvider: 'openai',
    getEmbeddingSpec: spec,
    secondaryEmbeddingCollection: () => 'products_openai',
    createEmbedding: jest.fn().mockResolvedValue([1, 2]),
  };
  const q: any = {
    validateEmbeddingCollection: jest.fn().mockResolvedValue(undefined),
    embeddingIndexComplete: jest.fn().mockResolvedValue(true),
    hybridSearch: jest.fn().mockResolvedValue([{ id: 'a' }]),
    keywordSearch: jest.fn().mockResolvedValue([{ id: 'a' }]),
    savePoint: jest.fn().mockResolvedValue(undefined),
  };
  const loadVersions = jest.fn(async () => versions);
  const run = (signal?: AbortSignal) =>
    retrieveWithEmbeddingFallback(ai, q, {
      collection: 'products',
      query: 'shoes',
      limit: 20,
      filter,
      loadVersions,
      signal,
    });
  return { ai, q, run, loadVersions };
}

describe('embedding failover and index freshness', () => {
  afterEach(() => jest.restoreAllMocks());
  it('disabled failover performs only the original embedding and hybrid search', async () => {
    const { ai, q, run, loadVersions } = setup();
    ai.embeddingFailover = false;
    ai.createQueryEmbedding = jest.fn().mockResolvedValue([3, 4]);
    await run();
    expect(loadVersions).not.toHaveBeenCalled();
    expect(q.embeddingIndexComplete).not.toHaveBeenCalled();
    expect(q.validateEmbeddingCollection).not.toHaveBeenCalled();
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    expect(q.hybridSearch).toHaveBeenCalledWith(
      'products',
      [3, 4],
      'shoes',
      20,
      filter,
    );
  });
  it('coalesces concurrent completeness scans and refreshes after five seconds', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { q, run, loadVersions } = setup();
    await Promise.all(Array.from({ length: 8 }, () => run()));
    expect(loadVersions).toHaveBeenCalledTimes(1);
    expect(q.embeddingIndexComplete).toHaveBeenCalledTimes(1);
    expect(q.validateEmbeddingCollection).toHaveBeenCalledTimes(1);
    expect(q.hybridSearch).toHaveBeenCalledTimes(8);
    now += 5001;
    await run();
    expect(loadVersions).toHaveBeenCalledTimes(2);
    expect(q.embeddingIndexComplete).toHaveBeenCalledTimes(2);
  });
  it('does not cache a failed PG snapshot or share cancellation between chats', async () => {
    const { ai, run, loadVersions } = setup();
    loadVersions.mockRejectedValueOnce(new Error('PG unavailable'));
    await expect(run()).rejects.toThrow('PG unavailable');
    let resolve!: (value: typeof versions) => void;
    loadVersions.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const controller = new AbortController();
    const first = run(controller.signal);
    const second = run();
    await Promise.resolve();
    controller.abort();
    resolve(versions);
    await expect(first).rejects.toBe(controller.signal.reason);
    await expect(second).resolves.toEqual([{ id: 'a' }]);
    expect(loadVersions).toHaveBeenCalledTimes(2);
    expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
  });
  it('writes invalidate cached completeness before the next search', async () => {
    const { ai, q, run, loadVersions } = setup();
    await run();
    await writeEmbeddingIndices(ai, q, {
      collection: 'products',
      id: 'a',
      version: 'v2',
      text: 'shoes',
      payload: {},
    });
    await run();
    expect(loadVersions).toHaveBeenCalledTimes(2);
  });
  it('a healthy primary never inspects a missing or stale secondary', async () => {
    const { ai, q, run } = setup();
    q.validateEmbeddingCollection.mockImplementation(async (collection) => {
      if (collection !== 'products')
        throw Object.assign(new Error('not found'), { status: 404 });
    });
    q.embeddingIndexComplete.mockImplementation(
      async (collection) => collection === 'products',
    );
    ai.secondaryEmbeddingCollection = jest.fn(() => 'products_openai');
    await expect(run()).resolves.toEqual([{ id: 'a' }]);
    expect(ai.secondaryEmbeddingCollection).not.toHaveBeenCalled();
    expect(q.validateEmbeddingCollection).toHaveBeenCalledTimes(1);
  });
  it('a missing secondary permits primary BM25 after primary embedding outage', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ai, q, run, loadVersions } = setup();
    ai.createEmbedding.mockRejectedValue(outage());
    q.validateEmbeddingCollection.mockImplementation(async (collection) => {
      if (collection !== 'products')
        throw Object.assign(new Error('not found'), { status: 404 });
    });
    await run();
    expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
    expect(q.keywordSearch).toHaveBeenCalledTimes(1);
    await run();
    expect(loadVersions).toHaveBeenCalledTimes(1);
    expect(q.validateEmbeddingCollection).toHaveBeenCalledTimes(2);
    expect(q.embeddingIndexComplete).toHaveBeenCalledTimes(2);
    expect(q.keywordSearch).toHaveBeenCalledTimes(2);
    now += 5001;
    q.validateEmbeddingCollection.mockResolvedValue(undefined);
    ai.createEmbedding.mockImplementation(async (_query, provider) => {
      if (provider === 'yandex') throw outage();
      return [1, 2];
    });
    await run();
    expect(loadVersions).toHaveBeenCalledTimes(2);
    expect(q.hybridSearch.mock.calls.at(-1)[0]).toBe('products_openai');
  });
  it('a missing secondary does not prevent updating the primary index', async () => {
    const { ai, q } = setup();
    q.validateEmbeddingCollection.mockImplementation(async (collection) => {
      if (collection !== 'products')
        throw Object.assign(new Error('not found'), { status: 404 });
    });
    const savePrimary = jest.fn();
    await writeEmbeddingIndices(ai, q, {
      collection: 'products',
      id: 'a',
      version: 'v2',
      text: 'shoes',
      payload: {},
      savePrimary,
    });
    expect(q.savePoint.mock.calls.map((c) => c[0])).toEqual([
      'products',
      'products',
    ]);
    expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
    expect(savePrimary).toHaveBeenCalledTimes(1);
  });
  it('primary only; empty search results do not trigger another provider', async () => {
    const { ai, q, run } = setup();
    q.hybridSearch.mockResolvedValue([]);
    expect(await run()).toEqual([]);
    expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
    expect(q.hybridSearch).toHaveBeenCalledWith(
      'products',
      [1, 2],
      'shoes',
      20,
      {
        must: [
          filter,
          indexVersionFilter(versions, embeddingSpace(spec('yandex'))),
        ],
      },
    );
  });
  it('secondary has its own embedding space and exactly the same hard filters; recovers primary next request', async () => {
    const { ai, q, run } = setup();
    ai.createEmbedding.mockRejectedValueOnce(outage());
    await run();
    expect(q.hybridSearch).toHaveBeenLastCalledWith(
      'products_openai',
      [1, 2],
      'shoes',
      20,
      {
        must: [
          filter,
          indexVersionFilter(versions, embeddingSpace(spec('openai'))),
        ],
      },
    );
    await run();
    expect(q.hybridSearch.mock.calls.map((c) => c[0])).toEqual([
      'products_openai',
      'products',
    ]);
  });
  it('both provider outages use BM25, with original filters and current source versions', async () => {
    const { ai, q, run } = setup();
    ai.createEmbedding.mockRejectedValue(outage());
    await run();
    expect(ai.createEmbedding).toHaveBeenCalledTimes(2);
    expect(q.hybridSearch).not.toHaveBeenCalled();
    expect(q.keywordSearch).toHaveBeenCalledWith('products', 'shoes', 20, {
      must: [filter, indexVersionFilter(versions)],
    });
  });
  it.each(['configuration', 'invalid-response'] as const)(
    '%s errors never fall back',
    async (category) => {
      const { ai, q, run } = setup();
      const error = new EmbeddingRequestError(category, 'yandex');
      ai.createEmbedding.mockRejectedValue(error);
      await expect(run()).rejects.toBe(error);
      expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
      expect(q.keywordSearch).not.toHaveBeenCalled();
    },
  );
  it('programming failures and total Qdrant outage propagate, not empty catalog', async () => {
    const { ai, q, run } = setup();
    const error = new Error('Qdrant down');
    q.validateEmbeddingCollection.mockRejectedValue(error);
    await expect(run()).rejects.toBe(error);
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    q.validateEmbeddingCollection.mockResolvedValue(undefined);
    ai.createEmbedding.mockRejectedValue(new TypeError('bug'));
    await expect(run()).rejects.toThrow('bug');
    expect(q.keywordSearch).not.toHaveBeenCalled();
  });
  it('missing/stale secondary index is skipped without embedding sends; incomplete sparse index is an error', async () => {
    const { ai, q, run } = setup();
    q.embeddingIndexComplete.mockResolvedValue(false);
    await expect(run()).rejects.toBeInstanceOf(EmbeddingIndexIncompleteError);
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    expect(q.keywordSearch).not.toHaveBeenCalled();
  });
  it('abort before or between providers never sends to fallback', async () => {
    const { ai, run } = setup();
    const c = new AbortController();
    c.abort();
    await expect(run(c.signal)).rejects.toBe(c.signal.reason);
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    const d = new AbortController();
    const reason = new Error('stop');
    ai.createEmbedding.mockImplementation(async () => {
      d.abort(reason);
      throw outage();
    });
    await expect(run(d.signal)).rejects.toBe(reason);
    expect(ai.createEmbedding).toHaveBeenCalledTimes(1);
  });
  it('writes sparse copies before dense; secondary outage leaves recoverable sparse data and primary PG write once', async () => {
    const { ai, q } = setup();
    ai.createEmbedding
      .mockResolvedValueOnce([1, 2])
      .mockRejectedValueOnce(outage());
    const savePrimary = jest.fn();
    await writeEmbeddingIndices(ai, q, {
      collection: 'products',
      id: 'a',
      version: 'v2',
      text: 'shoes',
      payload: { gender: 'female' },
      savePrimary,
    });
    expect(q.savePoint).toHaveBeenCalledTimes(3);
    expect(q.savePoint.mock.calls.slice(0, 2).map((c) => c[0])).toEqual([
      'products',
      'products_openai',
    ]);
    for (const [, point] of q.savePoint.mock.calls.slice(0, 2)) {
      expect(point.vector).not.toHaveProperty('dense');
      expect(point.payload).toEqual({
        gender: 'female',
        _source_version: 'v2',
      });
    }
    expect(savePrimary).toHaveBeenCalledTimes(1);
    expect(savePrimary).toHaveBeenCalledWith([1, 2]);
  });
  it('both embedding writes unavailable retain BM25 and remove obsolete primary PG vector', async () => {
    const { ai, q } = setup();
    ai.createEmbedding.mockRejectedValue(outage());
    const savePrimary = jest.fn();
    await writeEmbeddingIndices(ai, q, {
      collection: 'products',
      id: 'a',
      version: 'v2',
      text: 'shoes',
      payload: {},
      savePrimary,
    });
    expect(q.savePoint).toHaveBeenCalledTimes(2);
    expect(savePrimary).toHaveBeenCalledWith(null);
  });
  it('Qdrant count uses versions AND presence AND space, not aggregate point count', async () => {
    const client: any = {
      count: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
    };
    const q = new QdrantService(client);
    expect(await q.embeddingIndexComplete('secondary', versions, 'space')).toBe(
      false,
    );
    expect(client.count).toHaveBeenCalledWith('secondary', {
      exact: true,
      filter: indexVersionFilter(versions, 'space'),
    });
    await q.removeIndexPoints('secondary', ['a']);
    expect(client.delete).toHaveBeenCalledWith('secondary', {
      wait: true,
      points: ['a'],
    });
  });
  it('prune requires exact confirmation and nonempty source IDs before any Qdrant call', async () => {
    const client: any = {
      count: jest.fn(),
      scroll: jest.fn(),
      delete: jest.fn(),
    };
    const q = new QdrantService(client);
    for (const [ids, confirmation] of [
      [[], { collection: 'products', maxDeletes: 1 }],
      [['a'], { collection: 'wrong', maxDeletes: 1 }],
      [['a'], { collection: 'products', maxDeletes: 0 }],
      [['a'], { collection: 'products', maxDeletes: 1001 }],
    ] as const)
      await expect(
        q.pruneIndex('products', [...ids], confirmation),
      ).rejects.toThrow('Prune requires');
    expect(client.count).not.toHaveBeenCalled();
    expect(client.scroll).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });
  it('prune refuses mismatched source and an excessive/unfinished orphan selection', async () => {
    const client: any = {
      count: jest.fn().mockResolvedValue({ count: 0 }),
      scroll: jest.fn(),
      delete: jest.fn(),
    };
    const q = new QdrantService(client),
      confirmation = { collection: 'products', maxDeletes: 1 };
    await expect(q.pruneIndex('products', ['a'], confirmation)).rejects.toThrow(
      'source IDs do not match',
    );
    client.count.mockResolvedValue({ count: 1 });
    for (const result of [
      { points: [{ id: 'b' }, { id: 'c' }], next_page_offset: null },
      { points: [{ id: 'b' }], next_page_offset: 'c' },
    ]) {
      client.scroll.mockResolvedValue(result);
      await expect(
        q.pruneIndex('products', ['a'], confirmation),
      ).rejects.toThrow('deletion limit');
    }
    expect(client.delete).not.toHaveBeenCalled();
  });
  it('prune deletes only inspected IDs, never an unbounded filter', async () => {
    const client: any = {
      count: jest.fn().mockResolvedValue({ count: 1 }),
      scroll: jest
        .fn()
        .mockResolvedValue({ points: [{ id: 'b' }], next_page_offset: null }),
      delete: jest.fn(),
    };
    await new QdrantService(client).pruneIndex('products', ['a'], {
      collection: 'products',
      maxDeletes: 2,
    });
    expect(client.scroll).toHaveBeenCalledWith('products', {
      filter: { must_not: [{ has_id: ['a'] }] },
      limit: 3,
      with_payload: false,
      with_vector: false,
    });
    expect(client.delete).toHaveBeenCalledWith('products', {
      wait: true,
      points: ['b'],
    });
  });
});
