import { IsString, IsUUID, IsInt, IsOptional, Min } from 'class-validator';

export class AddProductToCartDto {
  @IsUUID()
  productId: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @IsOptional()
  userId?: string;
}
