import { Module } from '@nestjs/common';
import { SubcategoriesService } from './subcategories.service';
import { SubcategoriesController } from './subcategories.controller';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { BrandsService } from '../brands/brands.service';
import { CloudStorageModule } from '@/src/cloud-storage/cloud-storage.module';
import { BrandsModule } from '../brands/brands.module';

@Module({
  imports: [BrandsModule, CloudStorageModule],
  controllers: [SubcategoriesController],
  providers: [
    SubcategoriesService,
    ProductsService,
    CategoriesService,
    PrismaService,
    BrandsService,
    CloudStorageModule,
  ],
})
export class SubcategoriesModule {}
