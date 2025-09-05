import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { SubcategoriesService } from '../subcategories/subcategories.service';
import { CloudStorageService } from '@/src/cloud-storage/cloud-storage.service';

@Module({
  controllers: [BrandsController],
  providers: [
    BrandsService,
    PrismaService,
    ProductsService,
    CategoriesService,
    SubcategoriesService,
    CloudStorageService,
  ],
  exports: [BrandsService],
})
export class BrandsModule {}
