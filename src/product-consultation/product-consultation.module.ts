import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { PrismaModule } from '../core/prisma/prisma.module';

import { QdrantModule } from '../core/qdrant/qdrant.module';

import { RerankerModule } from '../core/reranker/reranker.module';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { PRODUCT_DETAILS_PORT } from '@/src/product-consultation/application/catalog/product-details.port';

import { PRODUCT_SEARCH_PORT } from '@/src/product-consultation/application/search/product-search.port';

import { CurrentStoreCatalogService } from '@/src/product-consultation/adapters/current-store/current-store-catalog.service';

import { CurrentStoreProductSearchService } from '@/src/product-consultation/adapters/current-store/current-store-product-search.service';

import {
  CURRENT_STORE_PRODUCT_NEED_SEARCH,
  CurrentStoreSearchSpecAdapter,
} from '@/src/product-consultation/adapters/current-store/current-store-search-spec.adapter';

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

    /**
     * Никакого отдельного current-store
     * details adapter здесь не требуется.
     *
     * CurrentStoreCatalogService уже
     * реализует нужный contract.
     */
    {
      provide: PRODUCT_DETAILS_PORT,

      useExisting: CurrentStoreCatalogService,
    },

    ProductAgentService,
  ],

  exports: [ProductAgentService, PRODUCT_SEARCH_PORT, PRODUCT_DETAILS_PORT],
})
export class ProductConsultationModule {}
