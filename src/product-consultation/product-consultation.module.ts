import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../core/prisma/prisma.module';
import { QdrantModule } from '../core/qdrant/qdrant.module';
import { RerankerModule } from '../core/reranker/reranker.module';

import { ProductAgentService } from './application/agent/product-agent.service';

@Module({
  imports: [AiModule, PrismaModule, QdrantModule, RerankerModule],

  providers: [ProductAgentService],

  exports: [ProductAgentService],
})
export class ProductConsultationModule {}
