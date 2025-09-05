import { Role } from '@/prisma/generated';
import { IsEnum, IsUUID } from 'class-validator';

export class CreateGuestDto {
  @IsUUID()
  id: string;

  @IsEnum(Role)
  role: Role;

  tokens: any;
}
