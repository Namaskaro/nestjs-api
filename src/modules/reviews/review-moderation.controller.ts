import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/generated';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/role.decorator';
import { CurrentUser } from '../user/decorators/user.decorator';
import {
  ModerateReviewDto,
  ReviewModerationQueryDto,
} from './dto/review-actions.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews/moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Manager)
export class ReviewModerationController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  getQueue(@Query() query: ReviewModerationQueryDto) {
    return this.reviewsService.getModerationQueue(query.kind);
  }

  @Patch('reviews/:reviewId')
  moderateReview(
    @CurrentUser('id') moderatorId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() data: ModerateReviewDto,
  ) {
    return this.reviewsService.moderateReview(moderatorId, reviewId, data);
  }

  @Patch('addenda/:addendumId')
  moderateAddendum(
    @CurrentUser('id') moderatorId: string,
    @Param('addendumId', ParseUUIDPipe) addendumId: string,
    @Body() data: ModerateReviewDto,
  ) {
    return this.reviewsService.moderateAddendum(moderatorId, addendumId, data);
  }
}
