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
  Put,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../user/decorators/user.decorator';
import {
  CreateReviewAddendumDto,
  ReviewPublicationDto,
} from './dto/review-actions.dto';
import {
  OwnReviewVotesQueryDto,
  ReviewListQueryDto,
  ReviewVoteDto,
} from './dto/review-list.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get(':productId')
  getByProductId(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: ReviewListQueryDto,
  ) {
    return this.reviewsService.getProductReviews(productId, query);
  }

  @Get(':productId/stats')
  getStats(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.reviewsService.getProductStats(productId);
  }

  @Get(':productId/my-votes')
  @UseGuards(JwtAuthGuard)
  getOwnVotes(
    @CurrentUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: OwnReviewVotesQueryDto,
  ) {
    return this.reviewsService.getOwnVotes(userId, productId, query.ids);
  }

  @Put(':reviewId/vote')
  @UseGuards(JwtAuthGuard)
  setVote(
    @CurrentUser('id') userId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() data: ReviewVoteDto,
  ) {
    return this.reviewsService.setVote(userId, reviewId, data);
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
