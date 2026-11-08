import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { AiService } from '@/src/ai/ai.service';
import { embeddingSpace } from '@/src/ai/embedding-execution';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { QdrantService } from '@/src/core/qdrant/qdrant.service';
import { QdrantCollections } from '@/src/core/qdrant/qdrant.collections';
import { publicReviewsQuery, publishedReviewWhere } from './review-publication';

const COLLECTION = QdrantCollections.reviews;
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 5;

export type ReviewSourceRef = {
  reviewId: string;
  publicationId: string;
  sourceId: string;
};
export type ReviewSource = ReviewSourceRef & {
  productId: string;
  sourceKind: 'review' | 'addendum';
  text: string;
  rating: number;
  publishedAt: Date;
  author: { id: string; name: string; image: string | null };
};

@Injectable()
export class ReviewIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewIndexService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly abort = new AbortController();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly qdrant: QdrantService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // Включается оператором после разрешения расхода на embedding.
    const enabled = this.config.get('REVIEW_INDEX_ENABLED') ?? 'false';
    if (!['true', 'false', true, false].includes(enabled))
      throw new Error('REVIEW_INDEX_ENABLED must be true or false');
    if (enabled !== true && enabled !== 'true') return;
    this.timer = setInterval(() => {
      void this.runPending().catch(() =>
        this.logger.error({ event: 'review_index_poll_failed' }),
      );
    }, 30_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.abort.abort();
    await this.running;
  }

  private spec() {
    const provider = this.config.get<string>('EMBEDDING_PROVIDER');
    if (provider !== 'yandex' && provider !== 'openai')
      throw new Error(
        'Review index requires configured primary embedding provider',
      );
    return this.ai.getEmbeddingSpec(provider);
  }

  async initializeCollection(): Promise<void> {
    await this.qdrant.createEmbeddingCollection(
      COLLECTION,
      this.spec().dimensions,
    );
    for (const field of [
      'productId',
      'reviewId',
      'publicationId',
      '_embedding_space',
    ])
      await this.qdrant.ensureKeywordIndex(COLLECTION, field);
  }

  /** Только PostgreSQL определяет доступность текста; payload не является источником. */
  private async sources(
    reviewIds: string[],
    productId?: string,
  ): Promise<ReviewSource[]> {
    if (!reviewIds.length) return [];
    const rows = await this.prisma.review.findMany({
      ...publicReviewsQuery,
      where: {
        ...publishedReviewWhere,
        id: { in: reviewIds },
        ...(productId ? { productId } : {}),
      },
      select: { ...publicReviewsQuery.select, productId: true },
    });
    return rows.flatMap((row) => {
      if (!row.user || !row.publishedAt || !row.productId) return [];
      const base = {
        productId: row.productId,
        reviewId: row.id,
        publicationId: row.publicationId,
        rating: row.rating,
        author: { ...row.user, name: row.user.name ?? 'Покупатель' },
      };
      return [
        {
          ...base,
          sourceId: row.publicationId,
          sourceKind: 'review' as const,
          text: row.text,
          publishedAt: row.publishedAt,
        },
        ...row.addenda.flatMap((entry) =>
          entry.publicationId === row.publicationId && entry.publishedAt
            ? [
                {
                  ...base,
                  sourceId: entry.id,
                  sourceKind: 'addendum' as const,
                  text: entry.text,
                  publishedAt: entry.publishedAt,
                },
              ]
            : [],
        ),
      ];
    });
  }

  async resolveSources(
    productId: string,
    refs: readonly ReviewSourceRef[],
  ): Promise<ReviewSource[]> {
    if (
      refs.length > 16 ||
      refs.some(
        (ref) =>
          !isUUID(ref.reviewId) ||
          !isUUID(ref.publicationId) ||
          !isUUID(ref.sourceId),
      )
    )
      throw new BadRequestException({ code: 'INVALID_REVIEW_SOURCES' });
    const rows = await this.sources(
      [...new Set(refs.map((ref) => ref.reviewId))],
      productId,
    );
    const byId = new Map(rows.map((row) => [row.sourceId, row]));
    return refs.flatMap((ref) => {
      const row = byId.get(ref.sourceId);
      return row?.reviewId === ref.reviewId &&
        row.publicationId === ref.publicationId
        ? [row]
        : [];
    });
  }

  async search(
    productId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<ReviewSource[]> {
    const text = query.trim();
    if (!isUUID(productId) || !text || text.length > 500)
      throw new BadRequestException({ code: 'INVALID_REVIEW_QUERY' });
    if (
      !(await this.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      }))
    )
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
    // Не расходуем query embedding при отсутствии опубликованного корпуса.
    if (
      !(await this.prisma.review.count({
        where: { ...publishedReviewWhere, productId },
      }))
    )
      return [];
    try {
      const spec = this.spec();
      await this.qdrant.validateEmbeddingCollection(
        COLLECTION,
        spec.dimensions,
      );
      const vector = await this.ai.createQueryEmbedding(text, { signal });
      signal?.throwIfAborted();
      const hits = await this.qdrant.hybridSearch(
        COLLECTION,
        vector,
        text,
        16,
        {
          must: [
            { key: 'productId', match: { value: productId } },
            { key: '_embedding_space', match: { value: embeddingSpace(spec) } },
          ],
        },
      );
      const refs: ReviewSourceRef[] = [];
      for (const hit of hits) {
        const payload = hit.payload;
        if (
          payload?.productId !== productId ||
          payload?._embedding_space !== embeddingSpace(spec) ||
          !isUUID(String(hit.id)) ||
          !isUUID(payload?.reviewId as string) ||
          !isUUID(payload?.publicationId as string)
        )
          continue;
        refs.push({
          sourceId: String(hit.id),
          reviewId: payload.reviewId as string,
          publicationId: payload.publicationId as string,
        });
      }
      return this.resolveSources(productId, refs);
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn({ event: 'review_retrieval_unavailable' });
      throw new ServiceUnavailableException({
        code: 'REVIEW_SEARCH_UNAVAILABLE',
        message: 'Поиск по отзывам временно недоступен.',
      });
    }
  }

  runPending(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.poll().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async poll() {
    if (this.abort.signal.aborted) return;
    const now = new Date();
    const due = {
      indexPending: true,
      indexAttempts: { lt: MAX_ATTEMPTS },
      AND: [
        {
          OR: [
            { indexNextAttemptAt: null },
            { indexNextAttemptAt: { lte: now } },
          ],
        },
        { OR: [{ indexLeaseUntil: null }, { indexLeaseUntil: { lte: now } }] },
      ],
    };
    const jobs = await this.prisma.review.findMany({
      where: due,
      orderBy: [{ indexNextAttemptAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: 5,
    });
    if (!jobs.length) return;
    await this.initializeCollection();
    for (const job of jobs) {
      if (this.abort.signal.aborted) break;
      const token = randomUUID();
      const claimed = await this.prisma.review.updateMany({
        where: { id: job.id, ...due },
        data: {
          indexLeaseToken: token,
          indexLeaseUntil: new Date(Date.now() + LEASE_MS),
          indexAttempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      const heartbeat = setInterval(() => {
        void this.prisma.review
          .updateMany({
            where: { id: job.id, indexLeaseToken: token },
            data: { indexLeaseUntil: new Date(Date.now() + LEASE_MS) },
          })
          .catch(() => undefined);
      }, LEASE_MS / 3);
      try {
        await this.indexReview(job.id, token);
        await this.prisma.review.updateMany({
          where: { id: job.id, indexLeaseToken: token },
          data: {
            indexPending: false,
            indexNextAttemptAt: null,
            indexLeaseToken: null,
            indexLeaseUntil: null,
            indexAttempts: 0,
          },
        });
      } catch {
        const state = await this.prisma.review.findUnique({
          where: { id: job.id },
          select: { indexAttempts: true },
        });
        const delay = [30_000, 120_000, 600_000, 3_600_000][
          Math.min((state?.indexAttempts ?? 1) - 1, 3)
        ];
        await this.prisma.review.updateMany({
          where: { id: job.id, indexLeaseToken: token },
          data: {
            indexLeaseToken: null,
            indexLeaseUntil: null,
            indexNextAttemptAt: new Date(Date.now() + delay),
          },
        });
        this.logger.warn({
          event: 'review_index_attempt_failed',
          reviewId: job.id,
          attempts: state?.indexAttempts,
          exhausted: (state?.indexAttempts ?? 0) >= MAX_ATTEMPTS,
        });
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  private async hasLease(reviewId: string, token: string) {
    const row = await this.prisma.review.findFirst({
      where: {
        id: reviewId,
        indexLeaseToken: token,
        indexLeaseUntil: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!row) throw new Error('REVIEW_INDEX_LEASE_LOST');
  }

  private async indexReview(reviewId: string, token: string) {
    const spec = this.spec();
    const space = embeddingSpace(spec);
    const sources = await this.sources([reviewId]);
    const points = await this.qdrant.retrievePoints(
      COLLECTION,
      sources.map((s) => s.sourceId),
    );
    try {
      for (const source of sources) {
        this.abort.signal.throwIfAborted();
        const hash = createHash('sha256').update(source.text).digest('hex');
        const existing = points.find(
          (point) => String(point.id) === source.sourceId,
        );
        if (
          existing?.payload?._source_version === hash &&
          existing.payload._embedding_space === space
        )
          continue;
        // Не обрезаем: отказ embedding-модели оставляет durable работу незавершённой.
        const vector = await this.ai.createDocumentEmbedding(source.text, {
          signal: this.abort.signal,
        });
        await this.hasLease(reviewId, token);
        await this.qdrant.savePoint(COLLECTION, {
          id: source.sourceId,
          vector: {
            dense: vector,
            bm25: { text: source.text, model: 'qdrant/bm25' },
          },
          payload: {
            productId: source.productId,
            reviewId,
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
    } finally {
      // Upsert мог сохраниться даже при ошибке ответа. Компенсация обязательна
      // и после потери lease; удаляются только уже недоступные immutable IDs.
      try {
        await this.cleanup(reviewId);
      } catch (error) {
        // Не теряем очистку, если новый worker уже успел подтвердить свою работу.
        await this.prisma.review.updateMany({
          where: { id: reviewId },
          data: {
            indexPending: true,
            indexLeaseToken: null,
            indexLeaseUntil: null,
            indexNextAttemptAt: new Date(Date.now() + 30_000),
          },
        });
        throw error;
      }
    }
    await this.hasLease(reviewId, token);
  }

  private async cleanup(reviewId: string) {
    // Сначала инспектируем IDs, затем читаем самую новую PG-публикацию.
    // Поздний worker не удаляет новую публикацию или новые дополнения.
    const inspected: string[] = [];
    let offset: string | number | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('REVIEW_INDEX_CLEANUP_LIMIT');
      const result = await this.qdrant.scrollPoints(
        COLLECTION,
        { must: [{ key: 'reviewId', match: { value: reviewId } }] },
        offset,
      );
      for (const point of result.points)
        if (point.payload?.reviewId === reviewId && isUUID(String(point.id)))
          inspected.push(String(point.id));
      if (result.next_page_offset == null) break;
      offset = result.next_page_offset as string | number;
    }
    const allowed = new Set(
      (await this.sources([reviewId])).map((source) => source.sourceId),
    );
    await this.qdrant.removeIndexPoints(
      COLLECTION,
      inspected.filter((id) => !allowed.has(id)),
    );
  }
}
