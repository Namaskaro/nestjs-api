import { IsString } from 'class-validator';

export class ActivateOperatotDto {
  @IsString()
  token: string;

  @IsString()
  passwordHashed: string;

  @IsString()
  name?: string;
}
