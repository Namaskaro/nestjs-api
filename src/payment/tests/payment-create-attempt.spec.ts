import { ConflictException } from '@nestjs/common';

import { OrderStatus, PaymentStatus, PaymentType } from '@/prisma/generated';

import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import { PaymentService } from '../payment.service';

import type { YookassaService } from '../yookassa/yookassa.service';

const ORDER = {
  id: 'order-1',
  userId: 'user-1',
  status: OrderStatus.PENDING_PAYMENT,
  paymentType: PaymentType.CARD,
  finalAmount: 12000,
  cartId: 'cart-1',
};

const PROVIDER_RESPONSE = {
  id: 'provider-payment-1',
  status: 'pending',
  paid: false,

  amount: {
    value: '12000.00',
    currency: 'RUB',
  },

  confirmation: {
    type: 'redirect',
    confirmation_url: 'https://example.com/pay/1',
  },

  created_at: '2026-10-23T10:00:00Z',
  test: true,
};

const SAVED_PAYMENT = {
  id: 1,
  orderId: ORDER.id,
  providerPaymentId: PROVIDER_RESPONSE.id,
  amount: ORDER.finalAmount,
  status: PaymentStatus.PENDING,
  rawResponse: PROVIDER_RESPONSE,
  paidAt: null,
  createdAt: new Date(),
};

function createHarness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER.id }] as never),

    order: {
      findFirstOrThrow: jest.fn().mockResolvedValue(ORDER as never),
    },

    payment: {
      findFirst: jest.fn().mockResolvedValue(null as never),

      count: jest.fn().mockResolvedValue(0 as never),

      create: jest.fn().mockResolvedValue({
        id: 1,
      } as never),
    },
  };

  const prisma = {
    order: {
      findFirstOrThrow: jest.fn().mockResolvedValue(ORDER as never),
    },

    payment: {
      updateMany: jest.fn().mockResolvedValue({
        count: 1,
      } as never),

      findUniqueOrThrow: jest.fn().mockResolvedValue(SAVED_PAYMENT as never),
    },

    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };

  const yookassa = {
    createPayment: jest.fn().mockResolvedValue(PROVIDER_RESPONSE as never),

    getPayment: jest.fn(),
  };

  const service = new PaymentService(
    prisma as unknown as PrismaService,
    yookassa as unknown as YookassaService,
  );

  return {
    service,
    prisma,
    tx,
    yookassa,
  };
}

function getIdempotenceKey(harness: ReturnType<typeof createHarness>): string {
  const params = harness.yookassa.createPayment.mock.calls[0]?.[0] as
    | { idempotenceKey: string }
    | undefined;

  if (!params) {
    throw new Error('Вызов ЮKassa отсутствует');
  }

  return params.idempotenceKey;
}

describe('PaymentService: payment admission', () => {
  it('reserves a payment before calling YooKassa', async () => {
    const harness = createHarness();

    const result = await harness.service.createPayment('user-1', 'order-1');

    expect(result).toEqual({
      paymentId: 1,
      providerPaymentId: 'provider-payment-1',
      status: PaymentStatus.PENDING,
      confirmationUrl: 'https://example.com/pay/1',
    });

    expect(harness.tx.payment.create).toHaveBeenCalledWith({
      data: {
        orderId: ORDER.id,

        providerPaymentId: expect.stringMatching(/^reservation:[a-f0-9]{64}$/),

        amount: 12000,
        status: PaymentStatus.PENDING,
        paidAt: null,

        rawResponse: {
          phase: 'CREATING',
          idempotenceKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });

    const reservationCall =
      harness.tx.payment.create.mock.invocationCallOrder[0];

    const providerCall =
      harness.yookassa.createPayment.mock.invocationCallOrder[0];

    expect(reservationCall).toBeLessThan(providerCall);

    expect(harness.prisma.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        providerPaymentId: expect.stringMatching(/^reservation:[a-f0-9]{64}$/),
        status: PaymentStatus.PENDING,
      },

      data: expect.objectContaining({
        providerPaymentId: 'provider-payment-1',
        status: PaymentStatus.PENDING,
        rawResponse: PROVIDER_RESPONSE,
      }),
    });
  });

  it('locks order row before admitting payment', async () => {
    const harness = createHarness();

    await harness.service.createPayment('user-1', 'order-1');

    expect(harness.tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(harness.tx.order.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        userId: 'user-1',
      },
    });
  });

  it('reuses an already created pending payment', async () => {
    const harness = createHarness();

    harness.tx.payment.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(SAVED_PAYMENT as never);

    const result = await harness.service.createPayment('user-1', 'order-1');

    expect(result.confirmationUrl).toBe('https://example.com/pay/1');

    expect(harness.tx.payment.create).not.toHaveBeenCalled();

    expect(harness.yookassa.createPayment).not.toHaveBeenCalled();
  });

  it('rejects creating another payment after successful payment', async () => {
    const harness = createHarness();

    harness.tx.payment.findFirst.mockResolvedValueOnce({
      id: 10,
    } as never);

    await expect(
      harness.service.createPayment('user-1', 'order-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.yookassa.createPayment).not.toHaveBeenCalled();
  });

  it('retries an unfinished reservation using its original key', async () => {
    const harness = createHarness();

    const originalKey = 'a'.repeat(64);

    harness.tx.payment.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 7,
        orderId: 'order-1',
        amount: 12000,
        status: PaymentStatus.PENDING,
        providerPaymentId: `reservation:${originalKey}`,
        createdAt: new Date(),

        rawResponse: {
          phase: 'CREATING',
          idempotenceKey: originalKey,
        },
      } as never);

    await harness.service.createPayment('user-1', 'order-1');

    expect(harness.tx.payment.create).not.toHaveBeenCalled();

    expect(harness.yookassa.createPayment).toHaveBeenCalledWith({
      orderId: 'order-1',
      amount: 12000,
      idempotenceKey: originalKey,
    });

    expect(harness.prisma.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        providerPaymentId: `reservation:${originalKey}`,
        status: PaymentStatus.PENDING,
      },

      data: expect.any(Object),
    });
  });

  it('does not retry an old unresolved reservation', async () => {
    const harness = createHarness();

    const originalKey = 'b'.repeat(64);

    harness.tx.payment.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 7,
        amount: 12000,
        status: PaymentStatus.PENDING,

        providerPaymentId: `reservation:${originalKey}`,

        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),

        rawResponse: {
          phase: 'CREATING',
          idempotenceKey: originalKey,
        },
      } as never);

    await expect(
      harness.service.createPayment('user-1', 'order-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.yookassa.createPayment).not.toHaveBeenCalled();
  });

  it('does not delete reservation after provider network error', async () => {
    const harness = createHarness();

    harness.yookassa.createPayment.mockRejectedValueOnce(
      new Error('Network failure') as never,
    );

    await expect(
      harness.service.createPayment('user-1', 'order-1'),
    ).rejects.toThrow('Network failure');

    expect(harness.tx.payment.create).toHaveBeenCalledTimes(1);

    expect(harness.prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects reusing payment with a different amount', async () => {
    const harness = createHarness();

    harness.tx.payment.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        ...SAVED_PAYMENT,
        amount: 9000,
      } as never);

    await expect(
      harness.service.createPayment('user-1', 'order-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.yookassa.createPayment).not.toHaveBeenCalled();
  });

  it('rejects reuse without a confirmation URL', async () => {
    const harness = createHarness();

    harness.tx.payment.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        ...SAVED_PAYMENT,

        rawResponse: {
          status: 'pending',
        },
      } as never);

    await expect(
      harness.service.createPayment('user-1', 'order-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses a stable key for the same payment attempt', async () => {
    const first = createHarness();
    const second = createHarness();

    await first.service.createPayment('user-1', 'order-1');

    await second.service.createPayment('user-1', 'order-1');

    expect(getIdempotenceKey(first)).toBe(getIdempotenceKey(second));
  });

  it('uses a new key after a failed payment attempt', async () => {
    const first = createHarness();
    const second = createHarness();

    second.tx.payment.count.mockResolvedValueOnce(1 as never);

    await first.service.createPayment('user-1', 'order-1');

    await second.service.createPayment('user-1', 'order-1');

    expect(getIdempotenceKey(first)).not.toBe(getIdempotenceKey(second));
  });

  it('rejects when order changes before transaction lock', async () => {
    const harness = createHarness();

    harness.tx.order.findFirstOrThrow.mockResolvedValueOnce({
      ...ORDER,
      status: OrderStatus.CANCELLED,
    } as never);

    await expect(
      harness.service.createPayment('user-1', 'order-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.tx.payment.create).not.toHaveBeenCalled();

    expect(harness.yookassa.createPayment).not.toHaveBeenCalled();
  });
});
