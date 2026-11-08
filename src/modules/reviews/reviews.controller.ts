import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../user/decorators/user.decorator';
import {
  CreateReviewAddendumDto,
  ReviewPublicationDto,
} from './dto/review-actions.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get(':productId')
  getByProductId(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.reviewsService.getProductReviews(productId);
  }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser('id') userId: string, @Body() data: CreateReviewDto) {
    return this.reviewsService.createReview(userId, data);
  }

  @Get(':productId/mine')
  @UseGuards(JwtAuthGuard)
  getMine(
    @CurrentUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.reviewsService.getMineAndEligibility(userId, productId);
  }

  @Post(':reviewId/addenda')
  @UseGuards(JwtAuthGuard)
  addAddendum(
    @CurrentUser('id') userId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() data: CreateReviewAddendumDto,
  ) {
    return this.reviewsService.addAddendum(userId, reviewId, data);
  }

  @Delete(':reviewId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  deleteReview(
    @CurrentUser('id') userId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query() query: ReviewPublicationDto,
  ) {
    return this.reviewsService.deleteReview(
      userId,
      reviewId,
      query.publicationId,
    );
  }
}
