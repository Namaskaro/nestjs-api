import { IsArray, IsString } from 'class-validator';

export class ProductSemanticInputDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  brand: string;

  @IsString()
  subcategory: string;

  @IsString()
  color: string;

  @IsArray()
  @IsString({ each: true })
  details: string[];

  @IsString()
  price: string;
}
