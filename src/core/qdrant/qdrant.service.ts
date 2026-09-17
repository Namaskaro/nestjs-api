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

// START ИЗМЕНЕНИЙ — EXPOSE NATIVE QDRANT FILTER TYPE

export type QdrantFilter = Schemas['Filter'];

// END ИЗМЕНЕНИЙ — EXPOSE NATIVE QDRANT FILTER TYPE

export type QdrantCollectionName =
  (typeof QdrantCollections)[keyof typeof QdrantCollections];

@Injectable()
export class QdrantService {
  constructor(
    @Inject(QDRANT_CLIENT)
    private readonly client: QdrantClient,
  ) {}

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

  async hybridSearch(
    collectionName: QdrantCollectionName,
    denseEmbedding: number[],
    query: string,
    limit: number,

    // START ИЗМЕНЕНИЙ — OPTIONAL SEARCH FILTER

    filter?: QdrantFilter,

    // END ИЗМЕНЕНИЙ — OPTIONAL SEARCH FILTER
  ): Promise<QdrantSearchPoint[]> {
    const filterConfig = filter ? { filter } : {};

    const result = await this.client.query(collectionName, {
      prefetch: [
        {
          query: denseEmbedding,
          using: QDRANT_DENSE_VECTOR,
          limit,

          // START ИЗМЕНЕНИЙ — FILTER DENSE CANDIDATES

          ...filterConfig,

          // END ИЗМЕНЕНИЙ — FILTER DENSE CANDIDATES
        },

        {
          query: {
            text: query,
            model: 'qdrant/bm25',
          },

          using: QDRANT_SPARSE_VECTOR,

          limit,

          // START ИЗМЕНЕНИЙ — FILTER BM25 CANDIDATES

          ...filterConfig,

          // END ИЗМЕНЕНИЙ — FILTER BM25 CANDIDATES
        },
      ],

      query: {
        fusion: 'rrf',
      },

      limit,

      with_payload: true,

      // START ИЗМЕНЕНИЙ — FILTER FINAL QUERY

      ...filterConfig,

      // END ИЗМЕНЕНИЙ — FILTER FINAL QUERY
    });

    return result.points;
  }
}