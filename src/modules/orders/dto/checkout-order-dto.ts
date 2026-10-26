import { DeliveryProvider, PaymentType } from '@/prisma/generated';

import {
  Equals,
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
  @Equals(PaymentType.CARD, {
    message: 'Доступна только онлайн-оплата картой',
  })
  paymentType: PaymentType;

  @IsOptional()
  @IsEnum(DeliveryProvider)
  deliveryProvider?: DeliveryProvider;

  @IsOptional()
  @IsString()
  promoCode?: string;
}
