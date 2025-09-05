import { IsNumber, IsString } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  userId: string;

  @IsString()
  productId: string;

  @IsString()
  text: string;

  @IsNumber()
  rating?: number;
}
