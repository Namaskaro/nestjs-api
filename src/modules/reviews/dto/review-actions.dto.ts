import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { normalizeReviewText } from './create-review.dto';

export class ReviewPublicationDto {
  @IsUUID()
  publicationId: string;
}

export class CreateReviewAddendumDto extends ReviewPublicationDto {
  @Transform(({ value }) => normalizeReviewText(value))
  @IsString()
  @Length(1, 4000)
  text: string;
}

export class ModerateReviewDto extends ReviewPublicationDto {
  @IsIn(['PUBLISHED', 'REJECTED'])
  decision: 'PUBLISHED' | 'REJECTED';

  @IsOptional()
  @Transform(({ value }) => normalizeReviewText(value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReviewModerationQueryDto {
  @IsOptional()
  @IsIn(['review', 'addendum'])
  kind?: 'review' | 'addendum';
}
