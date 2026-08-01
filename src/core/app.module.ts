import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { MailModule } from '../mail/mail.module';
import { EmailConfirmationModule } from '../modules/auth/email-confirmation/email-confirmation.module';
import { SocketService } from '../modules/socket/socket.service';
import { YookassaModule } from 'nestjs-yookassa';
import { getYookassaConfig } from './config/getYookassaConfig';
import { YoomoneyModule } from '../yoomoney/yookassa.module';
import { OrdersModule } from '../modules/orders/orders.module';
import { RedisModule } from '../modules/redis/redis.module';
import { PasswordRecoveryModule } from '../modules/auth/password-recovery/password-recovery.module';
import { TwoFactorAuthModule } from '../modules/auth/two-factor-auth/two-factor-auth.module';
import { SpeechModule } from '../speech/speech.module';
import { QdrantModule } from './qdrant/qdrant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: !IS_DEV_ENV,
    }),
    YookassaModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getYookassaConfig,
      inject: [ConfigService],
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
    MailModule,
    EmailConfirmationModule,
    YoomoneyModule,
    OrdersModule,
    RedisModule,
    PasswordRecoveryModule,
    TwoFactorAuthModule,
    SpeechModule,
    QdrantModule,
  ],
  controllers: [],
  providers: [SocketService],
})
export class AppModule {}
