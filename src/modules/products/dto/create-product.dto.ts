// import { ProductType, UserGender } from '@/prisma/generated';
// import {
//   ArrayNotEmpty,
//   IsArray,
//   IsEnum,
//   IsNotEmpty,
//   IsOptional,
//   IsString,
// } from 'class-validator';

// export class CreateProductDto {
//   @IsString()
//   @IsNotEmpty({
//     message: 'Название обязательно',
//   })
//   title: string;

//   @IsString()
//   @IsNotEmpty({
//     message: 'Описание обязательно',
//   })
//   description: string;

//   @IsString()
//   @IsNotEmpty({
//     message: 'Цена обязательна',
//   })
//   price: string;

//   @IsEnum(UserGender)
//   gender: UserGender;

//   @IsArray()
//   @ArrayNotEmpty()
//   @IsString({ each: true })
//   sizes: string[];

//   @IsEnum(ProductType)
//   type: ProductType;

//   @IsString()
//   @IsNotEmpty()
//   subcategoryId: string;

//   @IsString()
//   @IsNotEmpty()
//   brandId: string;

//   @IsOptional()
//   @IsString()
//   color?: string;

//   // START CHANGES — DETAILS ДОБАВЛЕНЫ В CREATE/UPDATE CONTRACT

//   @IsOptional()
//   @IsArray()
//   @IsString({ each: true })
//   details?: string[];

//   // END CHANGES — DETAILS ДОБАВЛЕНЫ В CREATE/UPDATE CONTRACT
// }

import { ProductType, UserGender } from '@/prisma/generated';

import { Transform, Type } from 'class-transformer';

import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

const transformToArray = (value: unknown) => {
  if (value === null || value === undefined) {
    return value;
  }

  return Array.isArray(value) ? value : [value];
};

const transformToBoolean = (value: unknown) => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

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

  @Transform(({ value }) => transformToArray(value))
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

  // Цвет товара
  @IsOptional()
  @IsString()
  color?: string;

  // Количество на складе
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  // Новая коллекция
  @IsOptional()
  @Transform(({ value }) => transformToBoolean(value))
  @IsBoolean()
  isNew?: boolean;

  // Скидка
  @IsOptional()
  @IsString()
  discount?: string;

  // Характеристики товара
  @IsOptional()
  @Transform(({ value }) => transformToArray(value))
  @IsArray()
  @IsString({ each: true })
  details?: string[];
}
