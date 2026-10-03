import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import type { OrderPort, OrderRecord } from '../ports/order.port';

@Injectable()
export class CurrentStoreOrderAdapter implements OrderPort {
  public constructor(private readonly prismaService: PrismaService) {}

  public async getUserOrders(userId: string): Promise<OrderRecord[]> {
    return this.prismaService.order.findMany({
      where: {
        userId,
      },

      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  public async getOrderById(
    userId: string,
    orderId: string,
  ): Promise<OrderRecord> {
    return this.prismaService.order.findFirstOrThrow({
      where: {
        id: orderId,
        userId,
      },

      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  public async getLatestUserOrder(
    userId: string,
  ): Promise<OrderRecord | null> {
    return this.prismaService.order.findFirst({
      where: {
        userId,
      },

      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
