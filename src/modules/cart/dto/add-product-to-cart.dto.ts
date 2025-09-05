import { IsString, IsUUID, IsInt, IsOptional, Min } from 'class-validator';

export class AddProductToCartDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  userId: string;
}
