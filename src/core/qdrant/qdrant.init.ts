import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';

import { QdrantService } from './qdrant.service';
import { AiService } from '@/src/ai/ai.service';

// ============================================================
// НОВОЕ:
// Отдельный infrastructure init.
//
// Запускается вручную.
// В обычной работе приложения НЕ выполняется.
// ============================================================

async function initQdrant(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const aiService = app.get(AiService);

    const qdrantService = app.get(QdrantService);

    // ==========================================================
    // НОВОЕ:
    // Не дублируем:
    //
    // Yandex = 768
    // OpenAI = 1536
    //
    // AiService сам выберет текущий AI_PROVIDER.
    //
    // Полученный embedding является нашим фактическим
    // контрактом размерности.
    // ==========================================================

    const dimensionProbe = await aiService.createDocumentEmbedding(
      'qdrant collection initialization',
    );

    const embeddingSize = dimensionProbe.length;

    await qdrantService.createCollections(embeddingSize);

    console.log(
      `Qdrant collections initialized. Embedding size: ${embeddingSize}`,
    );
  } finally {
    await app.close();
  }
}

void initQdrant();
