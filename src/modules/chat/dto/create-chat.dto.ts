import { ChatStatus } from '@/prisma/generated';
import { IsEnum, IsString } from 'class-validator';

export class CreateChatDto {
  @IsString()
  userId: string;

  @IsString()
  operatorId?: string;

  @IsEnum(ChatStatus)
  status: ChatStatus;
}
