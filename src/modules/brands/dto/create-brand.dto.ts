import { IsNotEmpty, IsString } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty({
    message: 'Название обязательно',
  })
  name: string;

  @IsString()
  @IsNotEmpty()
  coverImg: string;
}
