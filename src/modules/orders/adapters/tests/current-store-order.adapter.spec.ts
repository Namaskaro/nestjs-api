import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import { CurrentStoreOrderAdapter } from '../current-store-order.adapter';

describe('CurrentStoreOrderAdapter', () => {
  const order = {
    id: 'order-1',

    number: 10482,

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

    shipments: [],
  };

  let prisma: {
    order: {
      findMany: jest.Mock;

      findFirst: jest.Mock;

      findFirstOrThrow: jest.Mock;

      updateMany: jest.Mock;
    };

    $transaction: jest.Mock;
  };

  let tx: {
    $queryRaw: jest.Mock;
    order: {
      updateMany: jest.Mock;
      findFirstOrThrow: jest.Mock;
    };
  };

  let adapter: CurrentStoreOrderAdapter;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: order.id }] as never),
      order: {
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
    };

    prisma = {
      order: {
        findMany: jest.fn(),

        findFirst: jest.fn(),

        findFirstOrThrow: jest.fn(),

        updateMany: jest.fn(),
      },

      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
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

        number: '10482',

        status: 'PROCESSING',

        currency: null,

        shipments: [],
      }),
    );
  });

  it('returns null when atomic cancellation fails', async () => {
    tx.order.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      adapter.cancelOrder(
        'user-1',

        'order-1',
      ),
    ).resolves.toBeNull();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.order.findFirstOrThrow).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('returns cancelled order after successful cancellation', async () => {
    tx.order.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.order.findFirstOrThrow.mockResolvedValue({
      ...order,

      status: 'CANCELLED',
    });

    const result = await adapter.cancelOrder(
      'user-1',

      'order-1',
    );

    expect(result?.status).toBe('CANCELLED');
    expect(result?.number).toBe('10482');
    expect(result?.shipments).toEqual([]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [query, lockedOrderId] = tx.$queryRaw.mock.calls[0];
    expect((query as TemplateStringsArray).join('?').replace(/\s+/g, ' ').trim())
      .toBe('SELECT "id" FROM "order" WHERE "id" = ? FOR UPDATE');
    expect(lockedOrderId).toBe('order-1');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.order.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        userId: 'user-1',
        status: { in: ['DRAFT', 'PENDING_PAYMENT'] },
        payments: { none: { status: 'SUCCEEDED' } },
        shipments: {
          none: {
            status: {
              in: ['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'],
            },
          },
        },
      },
      data: { status: 'CANCELLED' },
    });
    expect(tx.order.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: 'order-1', userId: 'user-1' },
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        shipments: { orderBy: { createdAt: 'asc' } },
      },
    });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it('does not update or read an order when the row lock finds no order', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(adapter.cancelOrder('user-1', 'order-1')).resolves.toBeNull();

    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.order.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it('keeps the requesting user filter when another user tries to cancel an order', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(adapter.cancelOrder('other-user', 'order-1')).resolves.toBeNull();

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'order-1', userId: 'other-user' }),
      data: { status: 'CANCELLED' },
    });
    expect(tx.order.findFirstOrThrow).not.toHaveBeenCalled();
  });
});
