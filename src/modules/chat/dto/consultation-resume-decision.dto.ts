import { IsIn, IsUUID } from 'class-validator';

export class ConsultationResumeDecisionDto {
  @IsUUID()
  chatId: string;

  @IsUUID()
  offerId: string;

  @IsIn(['continue', 'later', 'start_new'])
  decision: 'continue' | 'later' | 'start_new';
}
