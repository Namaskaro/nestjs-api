import { Body, Controller, Post } from '@nestjs/common';

import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('embeddings/query')
  async createQueryEmbedding(@Body('text') text: string): Promise<number[]> {
    return this.aiService.createQueryEmbedding(text);
  }

  @Post('embeddings/document')
  async createDocumentEmbedding(@Body('text') text: string): Promise<number[]> {
    return this.aiService.createDocumentEmbedding(text);
  }

  @Post('embeddings/documents')
  async createDocumentEmbeddings(
    @Body('texts') texts: string[],
  ): Promise<number[][]> {
    return this.aiService.createDocumentEmbeddings(texts);
  }
}
