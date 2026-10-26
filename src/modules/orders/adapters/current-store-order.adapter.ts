import { Injectable } from '@nestjs/common';

import {
  OrderStatus as PrismaOrderStatus,
  PaymentStatus as PrismaPaymentStatus,
  ShipmentStatus as PrismaShipmentStatus,
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

import { lockCurrentStoreOrder } from './current-store-order-lock';

type CurrentStoreOrder = Prisma.OrderGetPayload<{
  include: {
    payments: true;
    shipments: true;
  };
}>;

const CURRENT_STORE_CANCELLABLE_STATUSES = CANCELLABLE_ORDER_STATUSES.map(
  (status) => status as PrismaOrderStatus,
);

const STARTED_SHIPMENT_STATUSES: PrismaShipmentStatus[] = [
  PrismaShipmentStatus.SHIPPED,
  PrismaShipmentStatus.IN_TRANSIT,
  PrismaShipmentStatus.OUT_FOR_DELIVERY,
  PrismaShipmentStatus.DELIVERED,
  PrismaShipmentStatus.EXCEPTION,
  PrismaShipmentStatus.RETURNED,
];

const MAX_PRISMA_ORDER_NUMBER = 2_147_483_647;

function parseCurrentStoreOrderNumber(value: string): number | null {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const number = Number(normalized);

  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > MAX_PRISMA_ORDER_NUMBER
  ) {
    return null;
  }

  return number;
}

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

        shipments: {
          orderBy: {
            createdAt: 'asc',
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

        shipments: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    return this.mapOrder(order);
  }

  public async getOrderByNumber(
    userId: string,
    orderNumber: string,
  ): Promise<OrderRecord | null> {
    const number = parseCurrentStoreOrderNumber(orderNumber);

    if (number === null) {
      return null;
    }

    const order = await this.prismaService.order.findFirst({
      where: {
        userId,
        number,
      },

      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },

        shipments: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    return order ? this.mapOrder(order) : null;
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

        shipments: {
          orderBy: {
            createdAt: 'asc',
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
    return this.prismaService.$transaction(async (tx) => {
      const orderExists = await lockCurrentStoreOrder(tx, orderId);

      if (!orderExists) {
        return null;
      }

      const result = await tx.order.updateMany({
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

          shipments: {
            none: {
              status: {
                in: STARTED_SHIPMENT_STATUSES,
              },
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

      const order = await tx.order.findFirstOrThrow({
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

          shipments: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

      return this.mapOrder(order);
    });
  }

  private mapOrder(order: CurrentStoreOrder): OrderRecord {
    const items = OrderItemRecordSchema.array().parse(order.items);

    return OrderRecordSchema.parse({
      id: order.id,

      number: String(order.number),

      createdAt: order.createdAt,

      updatedAt: order.updatedAt,

      userId: order.userId,

      token: order.token,

      cartId: order.cartId,

      totalAmount: order.totalAmount,

      finalAmount: order.finalAmount,

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

      shipments: order.shipments.map((shipment) => ({
        id: shipment.id,

        provider: shipment.provider,

        status: shipment.status,

        trackingNumber: shipment.trackingNumber,

        trackingUrl: shipment.trackingUrl,

        estimatedDeliveryAt: shipment.estimatedDeliveryAt,

        shippedAt: shipment.shippedAt,

        deliveredAt: shipment.deliveredAt,
      })),
    });
  }
}
