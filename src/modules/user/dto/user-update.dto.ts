import { IsEmail, IsString, Length } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @Length(1, 50)
  password: string;

  @IsEmail()
  email: string;
}
