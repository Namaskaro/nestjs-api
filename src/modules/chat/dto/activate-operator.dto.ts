import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ActivateOperatorDto {
  @IsUUID('4', {
    message: 'Некорректный токен приглашения',
  })
  token: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/\S/u, {
    message: 'Имя не может состоять только из пробелов',
  })
  name: string;

  @IsString()
  @MinLength(6, {
    message: 'Пароль должен содержать не менее 6 символов',
  })
  @MaxLength(128)
  password: string;
}
