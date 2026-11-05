import { IsEmail, MaxLength } from 'class-validator';

export class InviteOperatorDto {
  @IsEmail({}, { message: 'Укажите корректный email' })
  @MaxLength(254)
  email: string;
}
