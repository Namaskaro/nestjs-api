import { IsNumber, IsString, IsUUID } from 'class-validator';

export class UpdateQuantityDto {
  @IsUUID()
  cartItemId: string;

  @IsNumber()
  quantity: number;
}
