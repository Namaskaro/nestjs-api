import { DeliveryProvider, OrderStatus, PaymentType } from '@/prisma/generated';
import { IsNumber, IsString } from 'class-validator';

export class CheckoutOrderDto {
  status: OrderStatus;
  @IsString()
  fullName: string;
  @IsString()
  address: string;
  @IsString()
  email: string;
  @IsString()
  phone: string;
  @IsString()
  comment: string;
  deliveryDate: Date;
  @IsNumber()
  deliveryFee: number;
  @IsString()
  deliveryTime: string;
  paymentType: PaymentType;
  deliveryProvider: DeliveryProvider;
  @IsNumber()
  finalAmount: number;
}
