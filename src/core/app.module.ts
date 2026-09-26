import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IS_DEV_ENV } from 'src/shared/utils/is-dev.util';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from '../modules/auth/auth.module';
import { FileModule } from '../modules/file/file.module';
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
import { OrdersModule } from '../modules/orders/orders.module';
import { RedisModule } from '../modules/redis/redis.module';
import { PasswordRecoveryModule } from '../modules/auth/password-recovery/password-recovery.module';
import { TwoFactorAuthModule } from '../modules/auth/two-factor-auth/two-factor-auth.module';
import { SpeechModule } from '../speech/speech.module';
import { QdrantModule } from './qdrant/qdrant.module';
import { SupportAgentModule } from '../support-agent/support-agent.module';
import { RerankerModule } from './reranker/reranker.module';
import { StoreKnowledgeModule } from '../store-knowledge/store-knowledge.module';
import { YookassaModule } from '../payment/yookassa/yookassa.module';
import { PaymentModule } from '../payment/payment.module';
import { ProductConsultationModule } from '../product-consultation/product-consultation.module';

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
    MailModule,
    EmailConfirmationModule,
    YookassaModule,
    OrdersModule,
    RedisModule,
    PasswordRecoveryModule,
    TwoFactorAuthModule,
    SpeechModule,
    QdrantModule,
    SupportAgentModule,
    RerankerModule,
    StoreKnowledgeModule,
    PaymentModule,
    ProductConsultationModule,
  ],
  controllers: [],
  providers: [SocketService],
})
export class AppModule {}
