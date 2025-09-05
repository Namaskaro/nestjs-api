import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { UserService } from '../user/user.service';
import { SubcategoriesModule } from '../subcategories/subcategories.module';

@Module({
  imports: [SubcategoriesModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, PrismaService, UserService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
