import { IsUUID } from 'class-validator';

export class JoinChatDto {
  @IsUUID()
  chatId: string;
}
