import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IS_DEV_ENV } from 'src/shared/utils/is-dev.util';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from '../modules/auth/auth.module';
import { FileModule } from '../modules/file/file.module';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from '../modules/auth/guards/roles.guard';
import { UserModule } from '../modules/user/user.module';
import { CloudStorageModule } from '../cloud-storage/cloud-storage.module';
import { StorageModule } from '../modules/libs/storage/storage.module';
import { CartModule } from '../modules/cart/cart.module';
import { CategoriesModule } from '../modules/categories/categories.module';
import { ProductsModule } from '../modules/products/products.module';
import { BrandsModule } from '../modules/brands/brands.module';
import { SubcategoriesModule } from '../modules/subcategories/subcategories.module';
import { ReviewsModule } from '../modules/reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: !IS_DEV_ENV,
    }),
    PrismaModule,
    AuthModule,
    FileModule,
    UserModule,
    CloudStorageModule,
    StorageModule,
    CartModule,
    CategoriesModule,
    ProductsModule,
    BrandsModule,
    SubcategoriesModule,
    ReviewsModule,
  ],
  controllers: [],
  // providers: [
  //   {
  //     provide: APP_GUARD,
  //     useClass: RolesGuard,
  //   },
  // ],
})
export class AppModule {}
