import { Module } from '@nestjs/common';

import { PrismaModule } from '@/src/core/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';

import { CurrentStoreOrderAdapter } from './adapters/current-store-order.adapter';
import { ORDER_PORT } from './ports/order.port';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, AuthModule],

  controllers: [OrdersController],

  providers: [
    OrdersService,
    CurrentStoreOrderAdapter,
    {
      provide: ORDER_PORT,
      useExisting: CurrentStoreOrderAdapter,
    },
  ],

  exports: [OrdersService],
})
export class OrdersModule {}
