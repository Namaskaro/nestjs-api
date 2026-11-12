import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { QdrantService } from '@/src/core/qdrant/qdrant.service';
import { QdrantCollections } from '@/src/core/qdrant/qdrant.collections';
import type { ReviewVectorIndex } from '../application/ports';
import type { ReviewSource, ReviewSourceRef } from '../core/review-model';

export class QdrantReviewIndex implements ReviewVectorIndex {
  readonly collection: string;

  constructor(
    private readonly qdrant: QdrantService,
    readonly storeId: string,
  ) {
    // Preserve the existing single-store collection. Other stores have separate namespaces.
    this.collection =
      storeId === 'nextshop'
        ? QdrantCollections.reviews
        : `reviews_${createHash('sha256')
            .update(storeId)
            .digest('hex')
            .slice(0, 32)}`;
  }

  async initialize(dimensions: number) {
    await this.qdrant.createEmbeddingCollection(this.collection, dimensions);
    for (const field of [
      'productId',
      'reviewId',
      'publicationId',
      '_embedding_space',
    ])
      await this.qdrant.ensureKeywordIndex(this.collection, field);
  }

  async validate(dimensions: number) {
    await this.qdrant.validateEmbeddingCollection(this.collection, dimensions);
  }

  async search(
    productId: string,
    query: string,
    vector: number[],
    space: string,
  ) {
    const hits = await this.qdrant.hybridSearch(
      this.collection,
      vector,
      query,
      16,
      {
        must: [
          { key: 'productId', match: { value: productId } },
          { key: '_embedding_space', match: { value: space } },
        ],
      },
    );
    return hits.flatMap((hit): ReviewSourceRef[] => {
      const payload = hit.payload;
      if (
        payload?.productId !== productId ||
        payload._embedding_space !== space ||
        !isUUID(String(hit.id)) ||
        typeof payload.reviewId !== 'string' ||
        typeof payload.publicationId !== 'string' ||
        !isUUID(payload.reviewId) ||
        !isUUID(payload.publicationId)
      )
        return [];
      return [
        {
          sourceId: String(hit.id),
          reviewId: payload.reviewId,
          publicationId: payload.publicationId,
        },
      ];
    });
  }

  async versions(ids: string[]) {
    const points = await this.qdrant.retrievePoints(this.collection, ids);
    return new Map(
      points.map((point) => [
        String(point.id),
        {
          hash: point.payload?._source_version,
          space: point.payload?._embedding_space,
        },
      ]),
    );
  }

  async save(
    source: ReviewSource,
    vector: number[],
    space: string,
    hash: string,
  ) {
    await this.qdrant.savePoint(this.collection, {
      id: source.sourceId,
      vector: {
        dense: vector,
        bm25: { text: source.text, model: 'qdrant/bm25' },
      },
      payload: {
        productId: source.productId,
        reviewId: source.reviewId,
        publicationId: source.publicationId,
        sourceKind: source.sourceKind,
        ...(source.sourceKind === 'addendum'
          ? { addendumId: source.sourceId }
          : {}),
        _embedding_space: space,
        _source_version: hash,
      },
    });
  }

  async listByReview(id: string, offset?: string | number) {
    const result = await this.qdrant.scrollPoints(
      this.collection,
      {
        must: [{ key: 'reviewId', match: { value: id } }],
      },
      offset,
    );
    return {
      ids: result.points
        .filter(
          (point) => point.payload?.reviewId === id && isUUID(String(point.id)),
        )
        .map((point) => String(point.id)),
      next: (result.next_page_offset ?? undefined) as
        | string
        | number
        | undefined,
    };
  }

  remove(ids: string[]) {
    return this.qdrant.removeIndexPoints(this.collection, ids);
  }
}
