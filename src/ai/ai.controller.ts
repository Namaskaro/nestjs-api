import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('save-data/faq')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveFaqDataToDB() {
    return this.aiService.saveFaqEmbeddingsToDB();
  }
}
