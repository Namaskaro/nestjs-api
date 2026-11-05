import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '@/src/core/prisma/prisma.module';

import { YookassaModule } from '@/src/payment/yookassa/yookassa.module';

import { AuthModule } from '../auth/auth.module';

import { CurrentStoreOrderAdapter } from './adapters/current-store-order.adapter';

import { OrderCancellationCaseService } from './cancellation/order-cancellation-case.service';

import { OrdersController } from './orders.controller';

import { OrdersService } from './orders.service';

import { ORDER_PORT } from './ports/order.port';

import { RefundService } from './refund/refund.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule), YookassaModule],

  controllers: [OrdersController],

  providers: [
    OrdersService,
    OrderCancellationCaseService,
    RefundService,
    CurrentStoreOrderAdapter,

    {
      provide: ORDER_PORT,
      useExisting: CurrentStoreOrderAdapter,
    },
  ],

  exports: [OrdersService, OrderCancellationCaseService, RefundService],
})
export class OrdersModule {}
