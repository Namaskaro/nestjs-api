import { PartialType } from '@nestjs/mapped-types';

import { ShipmentStatus } from '@prisma/generated';

import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class CreateOrderShipmentDto {
  @IsString()
  @IsNotEmpty()
  provider: string;

  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;

  @IsOptional()
  @IsString()
  trackingNumber?: string | null;

  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  trackingUrl?: string | null;

  @IsOptional()
  @IsDateString()
  estimatedDeliveryAt?: string | null;

  @IsOptional()
  @IsDateString()
  shippedAt?: string | null;

  @IsOptional()
  @IsDateString()
  deliveredAt?: string | null;
}

export class UpdateOrderShipmentDto extends PartialType(
  CreateOrderShipmentDto,
) {}
