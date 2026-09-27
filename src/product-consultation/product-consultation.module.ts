import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { PrismaModule } from '../core/prisma/prisma.module';

import { QdrantModule } from '../core/qdrant/qdrant.module';

import { RerankerModule } from '../core/reranker/reranker.module';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { PRODUCT_CONSULTANT_MODEL_PORT } from '@/src/product-consultation/application/consultant/product-consultant-model.port';

import { PRODUCT_DETAILS_PORT } from '@/src/product-consultation/application/catalog/product-details.port';

import { PRODUCT_SEARCH_PORT } from '@/src/product-consultation/application/search/product-search.port';

import { CurrentStoreCatalogService } from '@/src/product-consultation/adapters/current-store/current-store-catalog.service';

import { CurrentStoreProductSearchService } from '@/src/product-consultation/adapters/current-store/current-store-product-search.service';

import {
  CURRENT_STORE_PRODUCT_NEED_SEARCH,
  CurrentStoreSearchSpecAdapter,
} from '@/src/product-consultation/adapters/current-store/current-store-search-spec.adapter';

import { LangChainProductConsultantModelAdapter } from '@/src/product-consultation/adapters/llm/langchain-product-consultant-model.adapter';

@Module({
  imports: [AiModule, PrismaModule, QdrantModule, RerankerModule],

  providers: [
    CurrentStoreCatalogService,

    CurrentStoreProductSearchService,

    {
      provide: CURRENT_STORE_PRODUCT_NEED_SEARCH,

      useExisting: CurrentStoreProductSearchService,
    },

    CurrentStoreSearchSpecAdapter,

    {
      provide: PRODUCT_SEARCH_PORT,

      useExisting: CurrentStoreSearchSpecAdapter,
    },

    {
      provide: PRODUCT_DETAILS_PORT,

      useExisting: CurrentStoreCatalogService,
    },

    /**
     * Первая настоящая LLM boundary
     * нового Product Consultation.
     *
     * Loop по-прежнему зависит
     * только от ModelPort.
     */
    LangChainProductConsultantModelAdapter,

    {
      provide: PRODUCT_CONSULTANT_MODEL_PORT,

      useExisting: LangChainProductConsultantModelAdapter,
    },

    /**
     * Legacy / compatibility.
     *
     * Пока не удаляем до переключения
     * vertical flow.
     */
    ProductAgentService,
  ],

  exports: [
    ProductAgentService,

    PRODUCT_SEARCH_PORT,

    PRODUCT_DETAILS_PORT,

    PRODUCT_CONSULTANT_MODEL_PORT,
  ],
})
export class ProductConsultationModule {}
