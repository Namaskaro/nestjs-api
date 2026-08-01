import { Type } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsNumber,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';

import { ProductQdrantPayload } from '../schemas/product-qdrant-payload.schema';

export class ProductBm25VectorDto {
  @IsString()
  text: string;

  @Equals('qdrant/bm25')
  model: 'qdrant/bm25';
}

export class ProductQdrantVectorDto {
  @IsArray()
  @IsNumber({}, { each: true })
  dense: number[];

  @ValidateNested()
  @Type(() => ProductBm25VectorDto)
  bm25: ProductBm25VectorDto;
}

export class ProductQdrantPointDto {
  @IsString()
  id: string;

  @ValidateNested()
  @Type(() => ProductQdrantVectorDto)
  vector: ProductQdrantVectorDto;

  @IsObject()
  payload: ProductQdrantPayload;
}
