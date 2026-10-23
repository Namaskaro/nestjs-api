import { Logger } from '@nestjs/common';
import type { AiService } from './ai.service';
import {
  embeddingSpace,
  EmbeddingRequestError,
  type EmbeddingOptions,
} from './embedding-execution';
import {
  indexVersionFilter,
  type QdrantService,
  type QdrantFilter,
  type QdrantSearchPoint,
  type IndexSourceVersion,
} from '../core/qdrant/qdrant.service';

const logger = new Logger('EmbeddingRetrieval');
// Small per-process snapshots, not a readiness guarantee across replicas.
// Share concurrent checks; never cache a rejected PG/Qdrant operation.
const SNAPSHOT_TTL_MS = 5_000;
type IndexSnapshot = {
  expiresAt: number;
  pending: number;
  versions: Promise<IndexSourceVersion[]>;
  checks: Map<string, Promise<boolean>>;
};
const snapshots = new WeakMap<QdrantService, Map<string, IndexSnapshot>>();

export function invalidateEmbeddingIndexSnapshot(
  qdrant: QdrantService,
  collection: string,
): void {
  snapshots.get(qdrant)?.delete(collection);
}

function indexSnapshot(
  qdrant: QdrantService,
  collection: string,
  load: () => Promise<IndexSourceVersion[]>,
): IndexSnapshot {
  let collections = snapshots.get(qdrant);
  if (!collections) snapshots.set(qdrant, (collections = new Map()));
  const cached = collections.get(collection);
  if (cached && (cached.pending > 0 || cached.expiresAt > Date.now()))
    return cached;
  const entry: IndexSnapshot = {
    expiresAt: 0,
    pending: 1,
    versions: undefined!,
    checks: new Map(),
  };
  collections.set(collection, entry);
  entry.versions = Promise.resolve()
    .then(load)
    .then((versions) => versions.map((v) => ({ ...v })))
    .catch((error) => {
      if (collections.get(collection) === entry) collections.delete(collection);
      throw error;
    })
    .finally(() => {
      entry.pending--;
      entry.expiresAt = Date.now() + SNAPSHOT_TTL_MS;
    });
  return entry;
}

async function indexComplete(
  qdrant: QdrantService,
  logicalCollection: string,
  snapshot: IndexSnapshot,
  collection: string,
  versions: IndexSourceVersion[],
  space?: string,
  dimensions?: number,
): Promise<boolean> {
  const key = JSON.stringify([collection, space, dimensions]);
  let check = snapshot.checks.get(key);
  if (!check) {
    snapshot.pending++;
    check = (async () => {
      if (dimensions !== undefined)
        await qdrant.validateEmbeddingCollection(collection, dimensions);
      return qdrant.embeddingIndexComplete(collection, versions, space);
    })()
      .catch((error) => {
        // An absent optional secondary is an incomplete snapshot, not a failed
        // primary check. Cache that result too, and discover recovery at expiry.
        if (
          collection !== logicalCollection &&
          (error as { status?: number })?.status === 404
        )
          return false;
        if (snapshots.get(qdrant)?.get(logicalCollection) === snapshot)
          invalidateEmbeddingIndexSnapshot(qdrant, logicalCollection);
        throw error;
      })
      .finally(() => {
        snapshot.pending--;
      });
    snapshot.checks.set(key, check);
  }
  return check;
}

export class EmbeddingIndexIncompleteError extends Error {
  constructor(collection: string) {
    super(
      `Retrieval index ${collection} is incomplete; run explicit reconciliation`,
    );
  }
}

export async function retrieveWithEmbeddingFallback(
  ai: AiService,
  qdrant: QdrantService,
  input: {
    collection: string;
    query: string;
    limit: number;
    filter?: QdrantFilter;
    loadVersions: () => Promise<IndexSourceVersion[]>;
  } & EmbeddingOptions,
): Promise<QdrantSearchPoint[]> {
  const { collection, query, limit, filter, signal } = input;
  signal?.throwIfAborted();
  if (!ai.embeddingFailover) {
    const vector = await (signal
      ? ai.createQueryEmbedding(query, { signal })
      : ai.createQueryEmbedding(query));
    signal?.throwIfAborted();
    return qdrant.hybridSearch(collection, vector, query, limit, filter);
  }
  const snapshot = indexSnapshot(qdrant, collection, input.loadVersions);
  const versions = await snapshot.versions;
  signal?.throwIfAborted();
  if (!versions.length) return [];
  for (const provider of ['yandex', 'openai'] as const) {
    const target =
      provider === 'yandex'
        ? collection
        : ai.secondaryEmbeddingCollection(collection);
    const spec = ai.getEmbeddingSpec(provider);
    const space = embeddingSpace(spec);
    const complete = await indexComplete(
      qdrant,
      collection,
      snapshot,
      target,
      versions,
      space,
      spec.dimensions,
    );
    signal?.throwIfAborted();
    if (!complete) {
      logger.warn({
        event: 'retrieval_degraded',
        provider,
        collection: target,
        reason: 'index_incomplete',
      });
      continue;
    }
    let vector: number[];
    try {
      vector = await ai.createEmbedding(query, provider, 'query', { signal });
    } catch (error) {
      signal?.throwIfAborted();
      if (
        !(error instanceof EmbeddingRequestError) ||
        error.category !== 'availability'
      )
        throw error;
      logger.warn({
        event: 'retrieval_degraded',
        provider,
        collection: target,
        reason: error.category,
        status: error.status,
      });
      continue;
    }
    signal?.throwIfAborted();
    const points = await qdrant.hybridSearch(target, vector, query, limit, {
      must: [...(filter ? [filter] : []), indexVersionFilter(versions, space)],
    });
    signal?.throwIfAborted();
    logger.log({
      event: 'retrieval_mode',
      mode: 'hybrid',
      provider,
      collection: target,
    });
    return points;
  }
  signal?.throwIfAborted();
  if (
    !(await indexComplete(qdrant, collection, snapshot, collection, versions))
  )
    throw new EmbeddingIndexIncompleteError(collection);
  const points = await qdrant.keywordSearch(collection, query, limit, {
    must: [...(filter ? [filter] : []), indexVersionFilter(versions)],
  });
  signal?.throwIfAborted();
  logger.warn({
    event: 'retrieval_mode',
    mode: 'bm25',
    provider: null,
    collection,
  });
  return points;
}

// Both sparse copies are written first, invalidating obsolete dense vectors.
// Availability errors leave sparse-only points; configuration/data failures propagate.
export async function writeEmbeddingIndices(
  ai: AiService,
  qdrant: QdrantService,
  input: {
    collection: string;
    id: string;
    version: string;
    text: string;
    payload: Record<string, unknown>;
    savePrimary?: (vector: number[] | null) => Promise<void>;
  } & EmbeddingOptions,
): Promise<void> {
  invalidateEmbeddingIndexSnapshot(qdrant, input.collection);
  try {
    const targets = ['yandex', 'openai'].map((provider) => {
      const spec = ai.getEmbeddingSpec(provider as 'yandex' | 'openai');
      return {
        spec,
        collection:
          provider === 'yandex'
            ? input.collection
            : ai.secondaryEmbeddingCollection(input.collection),
      };
    });
    const availableTargets: typeof targets = [];
    for (const target of targets) {
      input.signal?.throwIfAborted();
      try {
        await qdrant.validateEmbeddingCollection(
          target.collection,
          target.spec.dimensions,
        );
        availableTargets.push(target);
      } catch (error) {
        if (
          target.spec.provider !== 'openai' ||
          (error as { status?: number })?.status !== 404
        )
          throw error;
        logger.warn({
          event: 'index_pending',
          collection: target.collection,
          reason: 'secondary_missing',
        });
      }
    }
    const payload = { ...input.payload, _source_version: input.version };
    const sparse = { bm25: { text: input.text, model: 'qdrant/bm25' } };
    for (const target of availableTargets) {
      input.signal?.throwIfAborted();
      await qdrant.savePoint(target.collection, {
        id: input.id,
        vector: sparse,
        payload,
      });
    }
    for (const target of availableTargets) {
      input.signal?.throwIfAborted();
      let vector: number[];
      try {
        vector = await ai.createEmbedding(
          input.text,
          target.spec.provider,
          'document',
          { signal: input.signal },
        );
      } catch (error) {
        input.signal?.throwIfAborted();
        if (
          !(error instanceof EmbeddingRequestError) ||
          error.category !== 'availability'
        )
          throw error;
        if (target.spec.provider === 'yandex') await input.savePrimary?.(null);
        logger.warn({
          event: 'index_pending',
          provider: target.spec.provider,
          collection: target.collection,
          reason: error.category,
          status: error.status,
        });
        continue;
      }
      input.signal?.throwIfAborted();
      if (target.spec.provider === 'yandex') await input.savePrimary?.(vector);
      await qdrant.savePoint(target.collection, {
        id: input.id,
        vector: { ...sparse, dense: vector },
        payload: { ...payload, _embedding_space: embeddingSpace(target.spec) },
      });
    }
  } finally {
    invalidateEmbeddingIndexSnapshot(qdrant, input.collection);
  }
}
