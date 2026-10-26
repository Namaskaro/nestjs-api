import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '@/src/core/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';

import { CurrentStoreOrderAdapter } from './adapters/current-store-order.adapter';

import { ORDER_PORT } from './ports/order.port';

import { OrdersController } from './orders.controller';

import { OrdersService } from './orders.service';

import { OrderCancellationCaseService } from './order-cancellation-case.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],

  controllers: [OrdersController],

  providers: [
    OrdersService,

    OrderCancellationCaseService,

    CurrentStoreOrderAdapter,

    {
      provide: ORDER_PORT,
      useExisting: CurrentStoreOrderAdapter,
    },
  ],

  exports: [OrdersService, OrderCancellationCaseService],
})
export class OrdersModule {}
