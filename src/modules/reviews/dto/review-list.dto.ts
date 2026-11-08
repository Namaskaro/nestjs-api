import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReviewPublicationDto } from './review-actions.dto';

export type ReviewSort = 'date' | 'rating' | 'popular';

export class ReviewListQueryDto {
  @IsOptional()
  @IsIn(['date', 'rating', 'popular'])
  sort: ReviewSort = 'date';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take = 20;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}

export class ReviewVoteDto extends ReviewPublicationDto {
  @IsIn(['UP', 'DOWN', null])
  value: 'UP' | 'DOWN' | null;
}

export class OwnReviewVotesQueryDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids: string[];
}
