import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  chatId: string;

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;

  @IsOptional()
  @IsUUID()
  continuationOfferId?: string;

  @IsString()
  @MinLength(1)
  content: string;
}
