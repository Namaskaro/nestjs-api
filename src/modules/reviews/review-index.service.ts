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
import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { QdrantService } from '@/src/core/qdrant/qdrant.service';
import { AiReviewModels } from '@/src/review-intelligence/adapters/ai-review-models';
import { QdrantReviewIndex } from '@/src/review-intelligence/adapters/qdrant-review-index';
import {
  ReviewIndex,
  ReviewIndexError,
} from '@/src/review-intelligence/application/review-index';
import type { ReviewSourceRef } from '@/src/review-intelligence/core/review-model';
import { NextShopReviewSource } from './nextshop-review-source';
import { PrismaReviewJobs } from './prisma-review-jobs';

export type {
  ReviewSource,
  ReviewSourceRef,
} from '@/src/review-intelligence/core/review-model';

@Injectable()
export class ReviewIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewIndexService.name);
  private readonly index: ReviewIndex;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    prisma: PrismaService,
    ai: AiService,
    qdrant: QdrantService,
    private readonly config: ConfigService,
  ) {
    const source = new NextShopReviewSource(prisma);
    this.index = new ReviewIndex(
      source,
      new PrismaReviewJobs(prisma),
      new QdrantReviewIndex(qdrant, source.storeId),
      new AiReviewModels(ai, config),
      this.logger,
    );
  }

  onModuleInit() {
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
    await this.index.close();
  }

  initializeCollection() {
    return this.index.initializeCollection();
  }

  runPending() {
    return this.index.runPending();
  }

  resolveSources(productId: string, refs: readonly ReviewSourceRef[]) {
    return this.index.resolveSources(productId, refs).catch(transportError);
  }

  search(productId: string, query: string, signal?: AbortSignal) {
    return this.index.search(productId, query, signal).catch(transportError);
  }
}

function transportError(error: unknown): never {
  if (!(error instanceof ReviewIndexError)) throw error;
  if (error.code === 'PRODUCT_NOT_FOUND')
    throw new NotFoundException({ code: error.code });
  if (error.code === 'REVIEW_SEARCH_UNAVAILABLE')
    throw new ServiceUnavailableException({
      code: error.code,
      message: 'Поиск по отзывам временно недоступен.',
    });
  throw new BadRequestException({ code: error.code });
}
