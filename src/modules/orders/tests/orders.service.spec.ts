import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import type { OrderRecord } from '../core/order-record.schema';

import type { OrderPort } from '../ports/order.port';

import { OrdersService } from '../orders.service';

const order: OrderRecord = {
  id: 'order-1',

  createdAt: new Date(),

  updatedAt: new Date(),

  userId: 'user-1',

  token: null,

  cartId: 'cart-1',

  totalAmount: 1000,

  finalAmount: 1000,

  currency: null,

  status: 'PROCESSING',

  items: [],

  fullName: null,

  address: null,

  email: null,

  phone: null,

  comment: null,

  deliveryDate: null,

  deliveryFee: null,

  deliveryTime: null,

  deliveryProvider: null,

  paymentType: 'CARD',

  payments: [],
};

describe('OrdersService', () => {
  it('selects relevant order using core policy', async () => {
    const port = {
      getUserOrders: jest.fn().mockResolvedValue([order]),

      getOrderById: jest.fn(),

      getLatestUserOrder: jest.fn(),

      cancelOrder: jest.fn(),
    } as jest.Mocked<OrderPort>;

    const service = new OrdersService(
      port,

      {} as PrismaService,
    );

    await expect(service.getRelevantUserOrder('user-1')).resolves.toEqual(
      order,
    );
  });

  it('cancels eligible order through port', async () => {
    const cancelled = {
      ...order,

      status: 'CANCELLED' as const,
    };

    const port = {
      getUserOrders: jest.fn(),

      getOrderById: jest.fn().mockResolvedValue(order),

      getLatestUserOrder: jest.fn(),

      cancelOrder: jest.fn().mockResolvedValue(cancelled),
    } as jest.Mocked<OrderPort>;

    const service = new OrdersService(
      port,

      {} as PrismaService,
    );

    await expect(
      service.cancelOrder(
        'user-1',

        'order-1',
      ),
    ).resolves.toEqual(cancelled);
  });
});
