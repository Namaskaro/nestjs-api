import { BadRequestException } from '@nestjs/common';

import { OrderStatus, PaymentStatus, PaymentType } from '@prisma/generated';

import { validate } from 'class-validator';

import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import { CheckoutOrderDto } from '@/src/modules/orders/dto/checkout-order-dto';

import { PaymentService } from '../payment.service';

import type { YookassaService } from '../yookassa/yookassa.service';

function createHarness() {
  const tx = {
    payment: {
      update: jest.fn().mockResolvedValue({} as never),
      updateMany: jest.fn().mockResolvedValue({
        count: 1,
      } as never),
    },

    order: {
      updateMany: jest.fn().mockResolvedValue({
        count: 1,
      } as never),

      findUniqueOrThrow: jest.fn().mockResolvedValue({
        status: OrderStatus.PAID,
      } as never),
    },

    cartItem: {
      deleteMany: jest.fn().mockResolvedValue({
        count: 1,
      } as never),
    },
  };

  const order = {
    id: 'order-1',
    userId: 'user-1',
    status: OrderStatus.PENDING_PAYMENT,
    paymentType: PaymentType.CARD,
    cartId: 'cart-1',
    finalAmount: 12000,
  };

  const payment = {
    id: 1,
    orderId: 'order-1',
    providerPaymentId: 'provider-payment-1',
    amount: 12000,
    status: PaymentStatus.PENDING,
    paidAt: null,
    order,
  };

  const prisma = {
    order: {
      findFirstOrThrow: jest.fn().mockResolvedValue(order as never),
    },

    payment: {
      findFirstOrThrow: jest.fn().mockResolvedValue(payment as never),
      create: jest.fn(),
    },

    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as PrismaService;

  const yookassa = {
    getPayment: jest.fn().mockResolvedValue({
      id: 'provider-payment-1',
      status: 'succeeded',
    } as never),

    createPayment: jest.fn(),
  } as unknown as jest.Mocked<YookassaService>;

  const service = new PaymentService(prisma, yookassa);

  return {
    tx,
    prisma,
    yookassa,
    service,
  };
}

describe('Checkout prepayment validation', () => {
  it('rejects cash payment', async () => {
    const dto = Object.assign(new CheckoutOrderDto(), {
      fullName: 'Test User',
      address: 'Test address',
      email: 'test@example.com',
      phone: '+79990000000',
      deliveryDate: '2026-11-01',
      paymentType: PaymentType.CASH,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'paymentType')).toBe(true);
  });

  it('accepts card payment', async () => {
    const dto = Object.assign(new CheckoutOrderDto(), {
      fullName: 'Test User',
      address: 'Test address',
      email: 'test@example.com',
      phone: '+79990000000',
      deliveryDate: '2026-11-01',
      paymentType: PaymentType.CARD,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('PaymentService: prepayment lifecycle', () => {
  it('rejects payment for an order with CASH payment type', async () => {
    const { prisma, yookassa, service } = createHarness();

    (prisma.order.findFirstOrThrow as jest.Mock).mockResolvedValueOnce({
      id: 'order-1',
      status: OrderStatus.PENDING_PAYMENT,
      paymentType: PaymentType.CASH,
    } as never);

    await expect(
      service.createPayment('user-1', 'order-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(yookassa.createPayment).not.toHaveBeenCalled();
  });

  it('moves awaiting-payment order to PAID after successful payment', async () => {
    const { tx, service } = createHarness();

    const result = await service.syncPaymentStatus('user-1', 'order-1');

    expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);

    expect(result.orderStatus).toBe(OrderStatus.PAID);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: OrderStatus.PENDING_PAYMENT,
        paymentType: PaymentType.CARD,
      },

      data: {
        status: OrderStatus.PAID,
      },
    });

    expect(tx.cartItem.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not restore CANCELLED order after late successful payment', async () => {
    const { tx, service } = createHarness();

    tx.order.updateMany.mockResolvedValueOnce({
      count: 0,
    } as never);

    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: OrderStatus.CANCELLED,
    } as never);

    const result = await service.syncPaymentStatus('user-1', 'order-1');

    expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);

    expect(result.orderStatus).toBe(OrderStatus.CANCELLED);

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.SUCCEEDED,
        }),
      }),
    );

    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('does not restore SHIPPED order to PAID on repeated sync', async () => {
    const { tx, service } = createHarness();

    tx.order.updateMany.mockResolvedValueOnce({
      count: 0,
    } as never);

    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: OrderStatus.SHIPPED,
    } as never);

    const result = await service.syncPaymentStatus('user-1', 'order-1');

    expect(result.orderStatus).toBe(OrderStatus.SHIPPED);

    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('does not downgrade a shipped order after a failed payment', async () => {
    const { tx, yookassa, service } = createHarness();

    yookassa.getPayment.mockResolvedValueOnce({
      id: 'provider-payment-1',
      status: 'canceled',
    } as never);

    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: OrderStatus.SHIPPED,
    } as never);

    const result = await service.syncPaymentStatus('user-1', 'order-1');

    expect(result.paymentStatus).toBe(PaymentStatus.FAILED);

    expect(result.orderStatus).toBe(OrderStatus.SHIPPED);

    expect(tx.order.updateMany).not.toHaveBeenCalled();

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        status: PaymentStatus.PENDING,
      },

      data: expect.objectContaining({
        status: PaymentStatus.FAILED,
      }),
    });

    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });
});
