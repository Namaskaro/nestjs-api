import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateUserBioDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  secondName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  surname?: string;

  @IsOptional()
  @IsString()
  // @Matches(/^\d{4}-\d{2}-\d{2}$/, {
  //   message: 'birthDate must be in YYYY-MM-DD format',
  // })
  birthDate?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-()]+$/, {
    message: 'phone must be a valid phone number format',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(4, 10)
  postalIndex?: string;
}
