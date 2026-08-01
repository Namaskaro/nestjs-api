import { IsNotEmpty, IsString } from 'class-validator';

export class NewPasswordDto {
  @IsString({ message: 'Введите корректный адрес электронной почты' })
  @IsNotEmpty({ message: 'Новый пароль не может быть пустым' })
  password: string;
}
