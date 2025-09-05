import { IsNumber, IsString, IsUUID } from 'class-validator';

export class UpdateQuantityDto {
  cartItemId: string;

  @IsNumber()
  quantity: number;
}
