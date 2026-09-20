import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { ProductConsultationModule } from '../product-consultation/product-consultation.module';
import { StoreKnowledgeModule } from '../store-knowledge/store-knowledge.module';

import { SupportAgentController } from './support-agent.controller';
import { SupportAgentGraph } from './graph/support-agent.graph';
import { SupportAgentService } from './support-agent.service';

@Module({
  imports: [AiModule, ProductConsultationModule, StoreKnowledgeModule],

  controllers: [SupportAgentController],

  providers: [SupportAgentService, SupportAgentGraph],

  exports: [SupportAgentService],
})
export class SupportAgentModule {}
