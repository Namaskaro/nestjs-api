import { IsIn, IsUUID } from 'class-validator';

export class ConsultationResumeDecisionDto {
  @IsUUID()
  chatId: string;

  @IsUUID()
  offerId: string;

  @IsIn(['continue', 'later'])
  decision: 'continue' | 'later';
}
