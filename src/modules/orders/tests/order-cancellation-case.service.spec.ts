import { ConflictException, ForbiddenException } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import type { OrderRecord } from '../core/order-record.schema';

import { OrdersService } from '../orders.service';

import { OrderCancellationCaseService } from '../order-cancellation-case.service';

const USER_ID = 'user-1';
const CHAT_ID = 'chat-1';
const ORDER_ID = 'order-1';

function createOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: ORDER_ID,
    number: '10482',

    createdAt: new Date('2026-10-21T10:00:00.000Z'),
    updatedAt: new Date('2026-10-21T10:00:00.000Z'),

    userId: USER_ID,

    token: null,
    cartId: 'cart-1',

    totalAmount: 12000,
    finalAmount: 12000,
    currency: null,

    status: 'SHIPPED',

    items: [],

    fullName: null,
    address: null,
    email: null,
    phone: null,
    comment: null,

    deliveryDate: null,
    deliveryFee: null,
    deliveryTime: null,
    deliveryProvider: 'SDEK',

    paymentType: 'CARD',

    payments: [],

    shipments: [
      {
        id: 'shipment-1',
        provider: 'SDEK',
        status: 'IN_TRANSIT',
        trackingNumber: 'TRACK-123',
        trackingUrl: null,
        estimatedDeliveryAt: null,
        shippedAt: null,
        deliveredAt: null,
      },
    ],

    ...overrides,
  };
}

function createHarness() {
  const ordersService = {
    getOrderById: jest.fn(),
  } as unknown as jest.Mocked<OrdersService>;

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: CHAT_ID }] as never),

    supportCase: {
      findFirst: jest.fn().mockResolvedValue(null as never),

      create: jest.fn().mockResolvedValue({
        id: 'case-1',
      } as never),
    },
  };

  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as PrismaService;

  const service = new OrderCancellationCaseService(prisma, ordersService);

  return {
    tx,
    service,
    ordersService,
  };
}

describe('OrderCancellationCaseService', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();

    harness.ordersService.getOrderById.mockResolvedValue(createOrder());
  });

  it('creates a real support-case request for a shipped order', async () => {
    const { tx, service, ordersService } = harness;

    const result = await service.createOrGet(USER_ID, CHAT_ID, ORDER_ID);

    expect(ordersService.getOrderById).toHaveBeenCalledWith(USER_ID, ORDER_ID);

    expect(result).toEqual({
      caseId: 'case-1',
      orderId: ORDER_ID,
      orderNumber: '10482',
      route: 'INTERCEPT_DELIVERY',
      alreadyExists: false,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(tx.supportCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        chatId: CHAT_ID,
        reason: 'CUSTOMER_REQUEST',
        status: 'WAITING_OPERATOR',
      }),
    });
  });

  it('returns an existing active case instead of creating another', async () => {
    const { tx, service } = harness;

    tx.supportCase.findFirst.mockResolvedValue({
      id: 'existing-case',
    } as never);

    const result = await service.createOrGet(USER_ID, CHAT_ID, ORDER_ID);

    expect(result.caseId).toBe('existing-case');
    expect(result.alreadyExists).toBe(true);

    expect(tx.supportCase.create).not.toHaveBeenCalled();
  });

  it('rejects access to another user chat', async () => {
    const { tx, service } = harness;

    tx.$queryRaw.mockResolvedValue([] as never);

    await expect(
      service.createOrGet(USER_ID, 'another-user-chat', ORDER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.supportCase.findFirst).not.toHaveBeenCalled();

    expect(tx.supportCase.create).not.toHaveBeenCalled();
  });

  it('does not create a case when direct cancellation is available', async () => {
    const { tx, service, ordersService } = harness;

    ordersService.getOrderById.mockResolvedValue(
      createOrder({
        status: 'DRAFT',
        shipments: [],
      }),
    );

    await expect(
      service.createOrGet(USER_ID, CHAT_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.supportCase.create).not.toHaveBeenCalled();
  });

  it('does not create another cancellation case for an already cancelled order', async () => {
    const { tx, service, ordersService } = harness;

    ordersService.getOrderById.mockResolvedValue(
      createOrder({
        status: 'CANCELLED',
        shipments: [],
      }),
    );

    await expect(
      service.createOrGet(USER_ID, CHAT_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.supportCase.create).not.toHaveBeenCalled();
  });

  it('registers a paid but unshipped order for refund processing', async () => {
    const { service, ordersService } = harness;

    ordersService.getOrderById.mockResolvedValue(
      createOrder({
        status: 'PAID',
        shipments: [],
      }),
    );

    const result = await service.createOrGet(USER_ID, CHAT_ID, ORDER_ID);

    expect(result.route).toBe('REFUND_BEFORE_SHIPPING');
    expect(result.alreadyExists).toBe(false);
  });
});
