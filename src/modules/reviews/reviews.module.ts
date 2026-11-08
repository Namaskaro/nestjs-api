import { forwardRef, Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewModerationController } from './review-moderation.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [ReviewModerationController, ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
