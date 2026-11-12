import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { AiReviewModels } from '@/src/review-intelligence/adapters/ai-review-models';
import { ReviewSummaries } from '@/src/review-intelligence/application/review-summary';
import { PrismaReviewJobs } from './prisma-review-jobs';

@Injectable()
export class ReviewSummaryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewSummaryService.name);
  private readonly summaries: ReviewSummaries;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    prisma: PrismaService,
    ai: AiService,
    private readonly config: ConfigService,
  ) {
    this.summaries = new ReviewSummaries(
      new PrismaReviewJobs(prisma),
      new AiReviewModels(ai),
      () => ({
        inputTokenBudget: Number(
          config.get('REVIEW_SUMMARY_INPUT_TOKENS') ?? 6000,
        ),
        maxCalls: Number(config.get('REVIEW_SUMMARY_MAX_CALLS') ?? 32),
      }),
      this.logger,
    );
  }

  onModuleInit() {
    const enabled = this.config.get('REVIEW_SUMMARY_ENABLED') ?? 'false';
    if (!['true', 'false', true, false].includes(enabled))
      throw new Error('REVIEW_SUMMARY_ENABLED must be true or false');
    if (enabled !== true && enabled !== 'true') return;
    this.timer = setInterval(() => {
      void this.runPending().catch(() =>
        this.logger.error({ event: 'review_summary_poll_failed' }),
      );
    }, 30_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.summaries.close();
  }

  runPending() {
    return this.summaries.runPending();
  }
}
