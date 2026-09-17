import { DeliveryProvider, PaymentType } from '@/prisma/generated';

import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class CheckoutOrderDto {
  @IsString()
  fullName: string;

  @IsString()
  address: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsDateString()
  deliveryDate: string;

  @IsOptional()
  @IsString()
  deliveryTime?: string;

  @IsEnum(PaymentType)
  paymentType: PaymentType;

  @IsOptional()
  @IsEnum(DeliveryProvider)
  deliveryProvider?: DeliveryProvider;

  @IsOptional()
  @IsString()
  promoCode?: string;
}
