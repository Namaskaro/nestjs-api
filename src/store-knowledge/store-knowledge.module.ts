import { Module } from '@nestjs/common';

import { AiModule } from '@/src/ai/ai.module';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { QdrantModule } from '@/src/core/qdrant/qdrant.module';
import { RerankerModule } from '@/src/core/reranker/reranker.module';

import { StoreKnowledgeService } from './store-knowledge.service';
import { StoreKnowledgeController } from './store-knowledge.controller';

@Module({
  imports: [AiModule, PrismaModule, QdrantModule, RerankerModule],

  controllers: [StoreKnowledgeController],

  providers: [StoreKnowledgeService],

  exports: [StoreKnowledgeService],
})
export class StoreKnowledgeModule {}
