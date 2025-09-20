import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class FilterQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  take?: number = 10;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  searchTerm?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  subcategory?: string;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value, obj }) => {
    const raw = obj.brand ?? obj.brands ?? value;
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'string')
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  })
  brand?: string[];

  @IsOptional()
  @IsIn(['price', 'name', 'createdAt'])
  sort?: 'price' | 'name' | 'createdAt' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
