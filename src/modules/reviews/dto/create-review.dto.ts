import { Transform } from 'class-transformer';
import { IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export function normalizeReviewText(value: unknown): unknown {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/\r\n?/g, '\n').trim()
    : value;
}

export class CreateReviewDto {
  @IsUUID()
  productId: string;

  @Transform(({ value }) => normalizeReviewText(value))
  @IsString()
  @Length(1, 4000)
  text: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
}
