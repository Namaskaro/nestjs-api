import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/src/core/app.module';

import { StoreKnowledgeService } from './store-knowledge.service';

async function importStoreKnowledge(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error(
      'Не указан путь к JSON. Пример: npx ts-node -r tsconfig-paths/register src/store-knowledge/store-knowledge.import.ts ./store-knowledge-shipping.json',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const storeKnowledgeService = app.get(StoreKnowledgeService);

    const importedCount = await storeKnowledgeService.importJson(filePath);

    console.log(`Store Knowledge импортирован. Записей: ${importedCount}`);
  } finally {
    await app.close();
  }
}

void importStoreKnowledge();
