import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '../core/prisma/prisma.module';

import { AuthModule } from '../modules/auth/auth.module';
import { YookassaModule } from './yookassa/yookassa.module';

@Module({
  imports: [PrismaModule, YookassaModule, AuthModule],

  controllers: [PaymentController],

  providers: [PaymentService],

  exports: [PaymentService],
})
export class PaymentModule {}
