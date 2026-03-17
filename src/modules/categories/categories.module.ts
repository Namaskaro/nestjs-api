import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProductsService } from '../products/products.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { SubcategoriesService } from '../subcategories/subcategories.service';
import { BrandsService } from '../brands/brands.service';
import { CloudStorageService } from '@/src/cloud-storage/cloud-storage.service';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    ProductsService,
    PrismaService,
    SubcategoriesService,
    BrandsService,
    CloudStorageService,
  ],
  exports: [CategoriesService],
})
export class CategoriesModule {}
