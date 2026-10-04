import { Injectable } from '@nestjs/common';

import {
  OrderStatus as PrismaOrderStatus,
  PaymentStatus as PrismaPaymentStatus,
  type Prisma,
} from '@prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import {
  OrderItemRecordSchema,
  OrderRecordSchema,
  type OrderRecord,
} from '../core/order-record.schema';

import { CANCELLABLE_ORDER_STATUSES } from '../core/order-policy';

import type { OrderPort } from '../ports/order.port';

type CurrentStoreOrder = Prisma.OrderGetPayload<{
  include: {
    payments: true;
  };
}>;

const CURRENT_STORE_CANCELLABLE_STATUSES = CANCELLABLE_ORDER_STATUSES.map(
  (status) => status as PrismaOrderStatus,
);

@Injectable()
export class CurrentStoreOrderAdapter implements OrderPort {
  public constructor(private readonly prismaService: PrismaService) {}

  public async getUserOrders(userId: string): Promise<OrderRecord[]> {
    const orders = await this.prismaService.order.findMany({
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

    return orders.map((order) => this.mapOrder(order));
  }

  public async getOrderById(
    userId: string,
    orderId: string,
  ): Promise<OrderRecord> {
    const order = await this.prismaService.order.findFirstOrThrow({
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

    return this.mapOrder(order);
  }

  public async getLatestUserOrder(userId: string): Promise<OrderRecord | null> {
    const order = await this.prismaService.order.findFirst({
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

    return order ? this.mapOrder(order) : null;
  }

  public async cancelOrder(
    userId: string,
    orderId: string,
  ): Promise<OrderRecord | null> {
    const result = await this.prismaService.order.updateMany({
      where: {
        id: orderId,

        userId,

        status: {
          in: CURRENT_STORE_CANCELLABLE_STATUSES,
        },

        payments: {
          none: {
            status: PrismaPaymentStatus.SUCCEEDED,
          },
        },
      },

      data: {
        status: PrismaOrderStatus.CANCELLED,
      },
    });

    if (result.count !== 1) {
      return null;
    }

    const order = await this.prismaService.order.findFirstOrThrow({
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

    return this.mapOrder(order);
  }

  private mapOrder(order: CurrentStoreOrder): OrderRecord {
    const items = OrderItemRecordSchema.array().parse(order.items);

    return OrderRecordSchema.parse({
      id: order.id,

      createdAt: order.createdAt,

      updatedAt: order.updatedAt,

      userId: order.userId,

      token: order.token,

      cartId: order.cartId,

      totalAmount: order.totalAmount,

      finalAmount: order.finalAmount,

      /**
       * В текущей Prisma-модели валюта заказа
       * отдельно не хранится.
       *
       * Канонический OrderRecord поле имеет,
       * потому что внешние магазины вроде
       * Shopify могут возвращать валюту.
       */
      currency: null,

      status: order.status,

      items,

      fullName: order.fullName,

      address: order.address,

      email: order.email,

      phone: order.phone,

      comment: order.comment,

      deliveryDate: order.deliveryDate,

      deliveryFee: order.deliveryFee,

      deliveryTime: order.deliveryTime,

      deliveryProvider: order.deliveryProvider,

      paymentType: order.paymentType,

      payments: order.payments.map((payment) => ({
        id: payment.id,

        createdAt: payment.createdAt,

        updatedAt: payment.updatedAt,

        orderId: payment.orderId,

        providerPaymentId: payment.providerPaymentId,

        amount: payment.amount,

        status: payment.status,

        paidAt: payment.paidAt,

        rawResponse: payment.rawResponse,
      })),
    });
  }
}
