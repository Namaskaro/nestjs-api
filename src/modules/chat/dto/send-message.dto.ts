import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  chatId: string;

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;

  @IsOptional()
  @IsUUID()
  continuationOfferId?: string;

  @IsOptional()
  @IsIn(['resume_unchanged'])
  consultationAction?: 'resume_unchanged';

  @IsString()
  @MinLength(1)
  content: string;
}
