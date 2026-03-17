import { CartItem, PaymentType } from '@/prisma/generated';
import { IsArray, IsEnum, IsNumber, IsString } from 'class-validator';

export class CreateOrderDto {
  // @IsNumber()
  // totalAmount: number;

  // @IsNumber()
  // finalAmount: number;

  @IsString()
  userId: string;

  @IsString()
  cartId: string;
}
