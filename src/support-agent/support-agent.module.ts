import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { PrismaModule } from '../core/prisma/prisma.module';

import { SupportAgentController } from './support-agent.controller';

import { SupportAgentService } from './support-agent.service';

import { SupportAgentGraph } from './graph/support-agent.graph';

import { ProductAgentService } from './product-agent/product-agent.service';

@Module({
  imports: [AiModule, PrismaModule],

  controllers: [SupportAgentController],

  providers: [SupportAgentService, SupportAgentGraph, ProductAgentService],
})
export class SupportAgentModule {}
