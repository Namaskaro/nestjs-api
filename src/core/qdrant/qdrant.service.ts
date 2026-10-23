import { Inject, Injectable } from '@nestjs/common';

import type {
  QdrantClient,
  Schemas,
} from '@qdrant/js-client-rest' with {
  'resolution-mode': 'import',
};

import {
  QDRANT_CLIENT,
  QDRANT_DENSE_VECTOR,
  QDRANT_SPARSE_VECTOR,
} from './qdrant.constants';

import { QdrantCollections } from './qdrant.collections';

export type QdrantPoint = Schemas['PointStruct'];

export type QdrantSearchPoint = Awaited<
  ReturnType<QdrantClient['query']>
>['points'][number];

export type QdrantRetrievedPoint = Awaited<
  ReturnType<QdrantClient['retrieve']>
>[number];

export type QdrantFilter = Schemas['Filter'];

export type QdrantCollectionName = string;

export type IndexSourceVersion = { id: string; version: string };

export function indexVersionFilter(versions: readonly IndexSourceVersion[], space?: string): QdrantFilter {
  return { must: [
    { should: versions.map(item => ({ must: [
      { has_id: [item.id] }, { key: '_source_version', match: { value: item.version } },
    ] })) },
    { has_vector: space ? QDRANT_DENSE_VECTOR : QDRANT_SPARSE_VECTOR },
    ...(space ? [{ key: '_embedding_space', match: { value: space } }] : []),
  ] };
}

@Injectable()
export class QdrantService {
  constructor(
    @Inject(QDRANT_CLIENT)
    private readonly client: QdrantClient,
  ) {}

  async validateEmbeddingCollection(collection: string, dimensions: number): Promise<void> {
    const info = await this.client.getCollection(collection);
    const vectors = info.config.params.vectors as Record<string, { size: number; distance: string }>;
    if (vectors?.[QDRANT_DENSE_VECTOR]?.size !== dimensions || vectors?.[QDRANT_DENSE_VECTOR]?.distance !== 'Cosine' ||
      !info.config.params.sparse_vectors?.[QDRANT_SPARSE_VECTOR] || info.config.params.sparse_vectors[QDRANT_SPARSE_VECTOR].modifier !== 'idf')
      throw new Error(`Qdrant embedding collection ${collection} has incompatible vector configuration`);
  }

  async embeddingIndexComplete(collection: string, versions: readonly IndexSourceVersion[], space?: string): Promise<boolean> {
    if (!versions.length) return true;
    const result = await this.client.count(collection, { exact: true, filter: indexVersionFilter(versions, space) });
    return result.count === versions.length;
  }

  async keywordSearch(collection: string, query: string, limit: number, filter?: QdrantFilter): Promise<QdrantSearchPoint[]> {
    return (await this.client.query(collection, {
      query: { text: query, model: 'qdrant/bm25' }, using: QDRANT_SPARSE_VECTOR,
      limit, with_payload: true, ...(filter ? { filter } : {}),
    })).points;
  }

  async removeIndexPoints(collection: string, ids: string[]): Promise<void> {
    if (ids.length) await this.client.delete(collection, { wait: true, points: ids });
  }

  // Explicit reconciliation command only; never called by search or startup.
  async pruneIndex(collection: string, currentIds: string[], confirmation: { collection: string; maxDeletes: number }): Promise<void> {
    if (!confirmation || confirmation.collection !== collection || !/^[a-zA-Z0-9_-]+$/.test(collection) ||
      !Number.isInteger(confirmation.maxDeletes) || confirmation.maxDeletes < 1 || confirmation.maxDeletes > 1000 ||
      !currentIds.length || currentIds.some(id => typeof id !== 'string' || !id.trim()))
      throw new Error('Prune requires an exact collection confirmation, 1..1000 deletion limit and nonempty source IDs');
    const ids = [...new Set(currentIds)];
    const matching = await this.client.count(collection, { exact: true, filter: { must: [{ has_id: ids }] } });
    if (!matching.count) throw new Error('Prune refused: source IDs do not match this collection');
    const candidates = await this.client.scroll(collection, {
      filter: { must_not: [{ has_id: ids }] }, limit: confirmation.maxDeletes + 1,
      with_payload: false, with_vector: false,
    });
    if (candidates.next_page_offset != null || candidates.points.length > confirmation.maxDeletes)
      throw new Error('Prune refused: orphan count exceeds the confirmed deletion limit');
    if (candidates.points.some(point => ids.includes(String(point.id))))
      throw new Error('Prune refused: selected points overlap source IDs');
    // Delete only the inspected bounded IDs, never a filter whose matches can grow.
    if (candidates.points.length) await this.client.delete(collection, {
      wait: true, points: candidates.points.map(point => point.id),
    });
  }

  async createEmbeddingCollection(collection: string, dimensions: number): Promise<void> {
    const existing = (await this.client.getCollections()).collections.some(c => c.name === collection);
    if (!existing) await this.client.createCollection(collection, {
      vectors: { [QDRANT_DENSE_VECTOR]: { size: dimensions, distance: 'Cosine' } },
      sparse_vectors: { [QDRANT_SPARSE_VECTOR]: { modifier: 'idf' } },
    });
    await this.validateEmbeddingCollection(collection, dimensions);
  }

  async createCollections(embeddingSize: number): Promise<void> {
    const { collections } = await this.client.getCollections();

    const existingCollections = new Set(
      collections.map((collection) => collection.name),
    );

    for (const collectionName of Object.values(QdrantCollections)) {
      if (existingCollections.has(collectionName)) {
        continue;
      }

      await this.client.createCollection(collectionName, {
        vectors: {
          [QDRANT_DENSE_VECTOR]: {
            size: embeddingSize,
            distance: 'Cosine',
          },
        },

        sparse_vectors: {
          [QDRANT_SPARSE_VECTOR]: {
            modifier: 'idf',
          },
        },
      });
    }
  }

  async savePoint(
    collectionName: QdrantCollectionName,
    point: QdrantPoint,
  ): Promise<void> {
    await this.client.upsert(collectionName, {
      wait: true,
      points: [point],
    });
  }

  async savePoints(
    collectionName: QdrantCollectionName,
    points: QdrantPoint[],
  ): Promise<void> {
    if (points.length === 0) {
      return;
    }

    await this.client.upsert(collectionName, {
      wait: true,
      points,
    });
  }

  async retrievePoints(
    collectionName: QdrantCollectionName,
    ids: readonly string[],
  ): Promise<QdrantRetrievedPoint[]> {
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return [];
    }

    return this.client.retrieve(collectionName, {
      ids: uniqueIds,
      with_payload: true,
      with_vector: false,
    });
  }

  async hybridSearch(
    collectionName: QdrantCollectionName,
    denseEmbedding: number[],
    query: string,
    limit: number,
    filter?: QdrantFilter,
  ): Promise<QdrantSearchPoint[]> {
    const filterConfig = filter ? { filter } : {};

    const result = await this.client.query(collectionName, {
      prefetch: [
        {
          query: denseEmbedding,
          using: QDRANT_DENSE_VECTOR,
          limit,
          ...filterConfig,
        },

        {
          query: {
            text: query,
            model: 'qdrant/bm25',
          },

          using: QDRANT_SPARSE_VECTOR,
          limit,
          ...filterConfig,
        },
      ],

      query: {
        fusion: 'rrf',
      },

      limit,

      with_payload: true,

      ...filterConfig,
    });

    return result.points;
  }
}
