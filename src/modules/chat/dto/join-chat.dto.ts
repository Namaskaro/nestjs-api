import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class JoinChatDto {
  @IsUUID()
  chatId: string;

  @IsOptional()
  @IsBoolean()
  requestConsultationOffer?: boolean;
}
