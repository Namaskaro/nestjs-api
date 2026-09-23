import 'reflect-metadata';

import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';

import { NestFactory } from '@nestjs/core';

import { AiService } from '@/src/ai/ai.service';

import { ProductConsultationModule } from '@/src/product-consultation/product-consultation.module';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { CurrentProductConsultationTarget } from '../targets/current-product-consultation.target';

import { runDeterministicEvaluationScenario } from '../run-evaluations';

import { E01_PRODUCT_SELECTION_FLOW } from '../scenarios/e01-product-selection-flow.scenario';

import { formatEvaluationResult } from '../reporting/console-evaluation-report';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ProductConsultationModule,
  ],
})
class EvaluationRuntimeModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    EvaluationRuntimeModule,
    {
      logger: ['error', 'warn'],
    },
  );

  try {
    const aiService = app.get(AiService);

    const productAgentService = app.get(ProductAgentService);

    const target = new CurrentProductConsultationTarget(
      aiService,
      productAgentService,
    );

    const result = await runDeterministicEvaluationScenario({
      scenario: E01_PRODUCT_SELECTION_FLOW,

      target,
    });

    console.log(formatEvaluationResult(result));

    /**
     * FAIL здесь не означает,
     * что runner сломан.
     *
     * Наоборот:
     * baseline как раз должен показать
     * текущие проблемы ProductAgent.
     *
     * Только настоящий evaluation error
     * считаем ошибкой процесса.
     */
    if (result.status === 'error') {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
