import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import { CurrentStoreOrderAdapter } from '../current-store-order.adapter';

describe('CurrentStoreOrderAdapter', () => {
  const order = {
    id: 'order-1',

    createdAt: new Date(),

    updatedAt: new Date(),

    userId: 'user-1',

    token: null,

    totalAmount: 1000,

    finalAmount: 1000,

    status: 'PROCESSING',

    cartId: 'cart-1',

    items: [
      {
        productId: 'product-1',

        title: 'Nike Air Force 1',

        image: null,

        quantity: 1,

        size: '42',

        price: '1000',
      },
    ],

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

  let prisma: {
    order: {
      findMany: jest.Mock;

      findFirst: jest.Mock;

      findFirstOrThrow: jest.Mock;

      updateMany: jest.Mock;
    };
  };

  let adapter: CurrentStoreOrderAdapter;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn(),

        findFirst: jest.fn(),

        findFirstOrThrow: jest.fn(),

        updateMany: jest.fn(),
      },
    };

    adapter = new CurrentStoreOrderAdapter(prisma as unknown as PrismaService);
  });

  it('filters orders by authenticated user', async () => {
    prisma.order.findMany.mockResolvedValue([order]);

    await adapter.getUserOrders('user-1');

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
        },
      }),
    );
  });

  it('maps current store order to canonical record', async () => {
    prisma.order.findFirst.mockResolvedValue(order);

    const result = await adapter.getLatestUserOrder('user-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-1',

        status: 'PROCESSING',

        currency: null,
      }),
    );
  });

  it('returns null when atomic cancellation fails', async () => {
    prisma.order.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      adapter.cancelOrder(
        'user-1',

        'order-1',
      ),
    ).resolves.toBeNull();
  });

  it('returns cancelled order after successful cancellation', async () => {
    prisma.order.updateMany.mockResolvedValue({
      count: 1,
    });

    prisma.order.findFirstOrThrow.mockResolvedValue({
      ...order,

      status: 'CANCELLED',
    });

    const result = await adapter.cancelOrder(
      'user-1',

      'order-1',
    );

    expect(result?.status).toBe('CANCELLED');
  });
});
