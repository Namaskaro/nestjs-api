import { ProductType, UserGender } from '@/prisma/generated';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({
    message: 'Название обязательно',
  })
  title: string;

  @IsString()
  @IsNotEmpty({
    message: 'Описание обязательно',
  })
  description: string;

  @IsString()
  @IsNotEmpty({
    message: 'Цена обязательна',
  })
  price: string;

  @IsEnum(UserGender)
  gender: UserGender;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  sizes: string[];

  @IsEnum(ProductType)
  type: ProductType;

  @IsString()
  @IsNotEmpty()
  subcategoryId: string;

  @IsString()
  @IsNotEmpty()
  brandId: string;

  @IsOptional()
  @IsString()
  color?: string;

  // START CHANGES — DETAILS ДОБАВЛЕНЫ В CREATE/UPDATE CONTRACT

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  details?: string[];

  // END CHANGES — DETAILS ДОБАВЛЕНЫ В CREATE/UPDATE CONTRACT
}
