import { IsBoolean, IsUUID } from 'class-validator';

export class SubmitConsultationFeedbackDto {
  @IsUUID()
  chatId: string;

  @IsUUID()
  sessionId: string;

  @IsBoolean()
  helpful: boolean;
}
