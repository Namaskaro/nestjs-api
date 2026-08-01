import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SubcategoriesModule } from '../subcategories/subcategories.module';
import { BrandsModule } from '../brands/brands.module';
import { StorageModule } from '../libs/storage/storage.module';
import { CloudStorageModule } from '@/src/cloud-storage/cloud-storage.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { UserModule } from '../user/user.module';
import { AiModule } from '@/src/ai/ai.module';
import { QdrantModule } from '@/src/core/qdrant/qdrant.module';

@Module({
  imports: [
    PrismaModule, // ← ВОТ ЭТО ОБЯЗАТЕЛЬНО
    AuthModule,
    AiModule,
    SubcategoriesModule,
    BrandsModule,
    StorageModule,
    ConfigModule,
    CloudStorageModule,
    ReviewsModule,
    UserModule,
    QdrantModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
