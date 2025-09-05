import { UserGender } from '@/prisma/generated';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateSubcategoryDto {
  @IsString()
  @IsNotEmpty({
    message: 'Название обязательно',
  })
  name: string;

  @IsString()
  @IsNotEmpty({
    message: 'Название обязательно',
  })
  imageUrl: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsEnum(UserGender)
  gender: UserGender;
}
