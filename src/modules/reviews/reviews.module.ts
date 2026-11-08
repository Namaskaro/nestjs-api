import { forwardRef, Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewModerationController } from './review-moderation.controller';
import { ReviewIndexService } from './review-index.service';
import { ReviewSummaryService } from './review-summary.service';
import { AiModule } from '@/src/ai/ai.module';
import { QdrantModule } from '@/src/core/qdrant/qdrant.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    AiModule,
    QdrantModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [ReviewModerationController, ReviewsController],
  providers: [ReviewsService, ReviewIndexService, ReviewSummaryService],
  exports: [ReviewsService, ReviewIndexService, ReviewSummaryService],
})
export class ReviewsModule {}
