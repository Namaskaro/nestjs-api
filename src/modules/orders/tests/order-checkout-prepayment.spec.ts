import { BadRequestException, ConflictException } from '@nestjs/common';

import { OrderStatus, PaymentStatus, PaymentType } from '@prisma/generated';

import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import type { OrderPort } from '../ports/order.port';

import { CheckoutOrderDto } from '../dto/checkout-order-dto';

import { OrdersService } from '../orders.service';

const CHECKOUT_DTO: CheckoutOrderDto = {
  fullName: 'Test User',

  address: 'Москва, тестовый адрес',

  email: 'test@example.com',

  phone: '+79990000000',

  deliveryDate: '2026-11-01',

  paymentType: PaymentType.CARD,
};

function createHarness() {
  const prisma = {
    order: {
      findFirstOrThrow: jest.fn().mockResolvedValue({
        id: 'order-1',

        userId: 'user-1',

        status: OrderStatus.DRAFT,

        totalAmount: 12000,
      } as never),

      update: jest.fn().mockResolvedValue({
        id: 'order-1',

        status: OrderStatus.PENDING_PAYMENT,
      } as never),
    },

    payment: {
      findFirst: jest.fn().mockResolvedValue(null as never),
    },
  };

  const service = new OrdersService(
    {} as OrderPort,

    prisma as unknown as PrismaService,
  );

  return {
    prisma,
    service,
  };
}

describe('OrdersService checkout prepayment', () => {
  it('rejects CASH even when service is called directly', async () => {
    const { prisma, service } = createHarness();

    await expect(
      service.checkoutOrder('user-1', 'order-1', {
        ...CHECKOUT_DTO,

        paymentType: PaymentType.CASH,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.order.update).not.toHaveBeenCalled();

    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('moves checkout to PENDING_PAYMENT, not PROCESSING', async () => {
    const { prisma, service } = createHarness();

    await service.checkoutOrder('user-1', 'order-1', CHECKOUT_DTO);

    expect(prisma.payment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',

        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.SUCCEEDED],
        },
      },

      select: {
        id: true,
      },
    });

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
      },

      data: expect.objectContaining({
        paymentType: PaymentType.CARD,

        status: OrderStatus.PENDING_PAYMENT,
      }),

      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  });

  it('rejects checkout changes during active payment', async () => {
    const { prisma, service } = createHarness();

    prisma.payment.findFirst.mockResolvedValueOnce({
      id: 123,
    } as never);

    await expect(
      service.checkoutOrder('user-1', 'order-1', CHECKOUT_DTO),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('rejects another checkout after successful payment', async () => {
    const { prisma, service } = createHarness();

    prisma.order.findFirstOrThrow.mockResolvedValueOnce({
      id: 'order-1',

      userId: 'user-1',

      status: OrderStatus.PAID,

      totalAmount: 12000,
    } as never);

    await expect(
      service.checkoutOrder('user-1', 'order-1', CHECKOUT_DTO),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
