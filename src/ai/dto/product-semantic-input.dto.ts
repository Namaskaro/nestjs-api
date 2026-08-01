import { IsString } from 'class-validator';

export class ProductSemanticInputDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  brand: string;

  @IsString()
  category: string;

  @IsString()
  color: string;

  @IsString()
  price: string;
}
