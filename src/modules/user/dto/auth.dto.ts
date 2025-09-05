// import { Role } from '@/prisma/generated';
import { Role } from '@/prisma/generated';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class AuthDto {
  @IsOptional()
  @IsString()
  name: string;

  @IsString({
    message: 'Почта обязательна',
  })
  @IsEmail()
  email: string;

  role?: Role;

  @MinLength(6, { message: 'Пароль должен содержать не менее 6 символов' })
  @IsString({ message: 'Пароль обязателен' })
  password: string;
}
