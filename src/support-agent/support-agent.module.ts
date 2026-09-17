import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { PrismaModule } from '../core/prisma/prisma.module';

import { SupportAgentController } from './support-agent.controller';

import { SupportAgentService } from './support-agent.service';

import { SupportAgentGraph } from './graph/support-agent.graph';

import { ProductAgentService } from './agents/product-agent/product-agent.service';
import { QdrantModule } from '../core/qdrant/qdrant.module';
import { RerankerModule } from '../core/reranker/reranker.module';
import { StoreKnowledgeModule } from '../store-knowledge/store-knowledge.module';

@Module({
  imports: [
    AiModule,
    PrismaModule,
    QdrantModule,
    RerankerModule,
    StoreKnowledgeModule,
  ],

  controllers: [SupportAgentController],

  providers: [SupportAgentService, SupportAgentGraph, ProductAgentService],
  exports: [SupportAgentService],
})
export class SupportAgentModule {}
