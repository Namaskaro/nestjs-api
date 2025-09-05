import { IsString } from 'class-validator';

export class GetOrCreateCartDto {
  @IsString()
  cartToken?: string;

  @IsString()
  userId?: string;
}
