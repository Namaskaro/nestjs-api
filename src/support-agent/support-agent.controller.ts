import { Controller } from '@nestjs/common';
import { SupportAgentService } from './support-agent.service';

@Controller('support-agent')
export class SupportAgentController {
  constructor(private readonly supportAgentService: SupportAgentService) {}
}
