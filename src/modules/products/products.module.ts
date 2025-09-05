import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { SubcategoriesService } from '../subcategories/subcategories.service';
import { BrandsService } from '../brands/brands.service';
import { StorageService } from '../libs/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { CloudStorageModule } from '@/src/cloud-storage/cloud-storage.module';
import { CloudStorageService } from '@/src/cloud-storage/cloud-storage.service';
import { ReviewsService } from '../reviews/reviews.service';
import { UserService } from '../user/user.service';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    PrismaService,
    SubcategoriesService,
    BrandsService,
    StorageService,
    ConfigService,
    CloudStorageService,
    ReviewsService,
    UserService,
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
