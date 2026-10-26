import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import type { OrderPort } from '../ports/order.port';

import type { OrderRecord } from '../core/order-record.schema';

import { CurrentStoreOrderAdapter } from '../adapters/current-store-order.adapter';

import { getOrderCancellationEligibility } from '../core/order-policy';

import { canTransitionShipmentStatus } from '../core/shipment-policy';

import { OrdersService } from '../orders.service';

const SHIPMENT = {
  id: 'shipment-1',
  orderId: 'order-1',
  provider: 'SDEK',
  status: 'PENDING' as const,
  trackingNumber: 'TRACK-123',
  trackingUrl: null,
  estimatedDeliveryAt: null,
  shippedAt: null,
  deliveredAt: null,
  createdAt: new Date('2026-10-13T00:00:00.000Z'),
  updatedAt: new Date('2026-10-13T00:00:00.000Z'),
};

const PROCESSING_ORDER = {
  status: 'PROCESSING',
  paymentType: 'CARD',
  finalAmount: 12000,
};

const SHIPPED_ORDER = {
  ...PROCESSING_ORDER,
  status: 'SHIPPED',
};

function createHarness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'order-1' }] as never),

    order: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },

    payment: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 } as never),
    },

    shipment: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as PrismaService;

  const port = {} as OrderPort;

  const service = new OrdersService(port, prisma);

  return {
    tx,
    prisma,
    service,
  };
}

describe('OrdersService: shipment lifecycle', () => {
  it('creates a pending shipment without changing order status', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(PROCESSING_ORDER as never);

    tx.shipment.create.mockResolvedValue(SHIPMENT as never);

    tx.shipment.findMany.mockResolvedValue([{ status: 'PENDING' }] as never);

    const result = await service.createOrderShipment('order-1', {
      provider: 'SDEK',
      trackingNumber: 'TRACK-123',
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(tx.payment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        status: 'SUCCEEDED',
        amount: 12000,
      },
      select: {
        id: true,
      },
    });

    expect(tx.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        provider: 'SDEK',
        status: 'PENDING',
        trackingNumber: 'TRACK-123',
      }),
    });

    expect(result.id).toBe('shipment-1');
    expect(result.status).toBe('PENDING');

    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('changes order to SHIPPED when shipment enters transit', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(PROCESSING_ORDER as never);

    tx.shipment.create.mockResolvedValue({
      ...SHIPMENT,
      status: 'IN_TRANSIT',
    } as never);

    tx.shipment.findMany.mockResolvedValue([{ status: 'IN_TRANSIT' }] as never);

    await service.createOrderShipment('order-1', {
      provider: 'SDEK',
      status: 'IN_TRANSIT',
    });

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: {
          in: ['PAID', 'PROCESSING'],
        },
      },
      data: {
        status: 'SHIPPED',
      },
    });
  });

  it('marks order DELIVERED when every shipment is delivered', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(SHIPPED_ORDER as never);

    tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment-2',
      status: 'IN_TRANSIT',
    } as never);

    tx.shipment.update.mockResolvedValue({
      ...SHIPMENT,
      id: 'shipment-2',
      status: 'DELIVERED',
    } as never);

    tx.shipment.findMany.mockResolvedValue([
      { status: 'DELIVERED' },
      { status: 'DELIVERED' },
    ] as never);

    const result = await service.updateOrderShipment('order-1', 'shipment-2', {
      status: 'DELIVERED',
    });

    expect(result.status).toBe('DELIVERED');

    expect(tx.payment.findFirst).toHaveBeenCalledTimes(1);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: {
          in: ['PAID', 'PROCESSING', 'SHIPPED'],
        },
      },
      data: {
        status: 'DELIVERED',
      },
    });
  });

  it('keeps order SHIPPED when only one shipment is delivered', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(SHIPPED_ORDER as never);

    tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment-1',
      status: 'IN_TRANSIT',
    } as never);

    tx.shipment.update.mockResolvedValue({
      ...SHIPMENT,
      status: 'DELIVERED',
    } as never);

    tx.shipment.findMany.mockResolvedValue([
      { status: 'DELIVERED' },
      { status: 'IN_TRANSIT' },
    ] as never);

    await service.updateOrderShipment('order-1', 'shipment-1', {
      status: 'DELIVERED',
    });

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: {
          in: ['PAID', 'PROCESSING'],
        },
      },
      data: {
        status: 'SHIPPED',
      },
    });

    expect(tx.order.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'DELIVERED',
        },
      }),
    );
  });

  it('rejects changing DELIVERED shipment back to IN_TRANSIT', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue({
      ...SHIPPED_ORDER,
      status: 'DELIVERED',
    } as never);

    tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment-1',
      status: 'DELIVERED',
    } as never);

    await expect(
      service.updateOrderShipment('order-1', 'shipment-1', {
        status: 'IN_TRANSIT',
      }),
    ).rejects.toThrow('Недопустимый переход статуса отправления');

    expect(tx.shipment.update).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('allows updating tracking metadata for a paid order', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(SHIPPED_ORDER as never);

    tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment-1',
      status: 'IN_TRANSIT',
    } as never);

    tx.shipment.update.mockResolvedValue({
      ...SHIPMENT,
      status: 'IN_TRANSIT',
      trackingNumber: 'TRACK-UPDATED',
    } as never);

    tx.shipment.findMany.mockResolvedValue([{ status: 'IN_TRANSIT' }] as never);

    const result = await service.updateOrderShipment('order-1', 'shipment-1', {
      trackingNumber: 'TRACK-UPDATED',
    });

    expect(result.trackingNumber).toBe('TRACK-UPDATED');

    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: {
        id: 'shipment-1',
      },
      data: {
        trackingNumber: 'TRACK-UPDATED',
      },
    });
  });

  it('rejects creating shipment for a cancelled order', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue({
      ...PROCESSING_ORDER,
      status: 'CANCELLED',
    } as never);

    await expect(
      service.createOrderShipment('order-1', {
        provider: 'SDEK',
      }),
    ).rejects.toThrow(
      'Для заказа в текущем статусе нельзя создать отправление',
    );

    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('rejects shipment update for another order', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(PROCESSING_ORDER as never);

    tx.shipment.findFirst.mockResolvedValue(null as never);

    await expect(
      service.updateOrderShipment('order-1', 'shipment-of-another-order', {
        status: 'IN_TRANSIT',
      }),
    ).rejects.toThrow('Отправление не найдено');

    expect(tx.shipment.update).not.toHaveBeenCalled();
  });

  it('does not create shipment when order lock finds no row', async () => {
    const { tx, service } = createHarness();

    tx.$queryRaw.mockResolvedValueOnce([] as never);

    await expect(
      service.createOrderShipment('missing-order', {
        provider: 'SDEK',
      }),
    ).rejects.toThrow('Заказ не найден');

    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('rejects shipment creation without a successful payment', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(PROCESSING_ORDER as never);

    tx.payment.findFirst.mockResolvedValueOnce(null as never);

    await expect(
      service.createOrderShipment('order-1', {
        provider: 'SDEK',
        status: 'IN_TRANSIT',
      }),
    ).rejects.toThrow(
      'Нельзя оформить отправление без подтверждённой полной оплаты заказа',
    );

    expect(tx.shipment.create).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects shipment creation for a CASH order', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue({
      ...PROCESSING_ORDER,
      paymentType: 'CASH',
    } as never);

    await expect(
      service.createOrderShipment('order-1', {
        provider: 'SDEK',
      }),
    ).rejects.toThrow('Отправка возможна только для заказа с онлайн-оплатой');

    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('rejects updating a shipment without confirmed payment', async () => {
    const { tx, service } = createHarness();

    tx.order.findUnique.mockResolvedValue(PROCESSING_ORDER as never);

    tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment-1',
      status: 'PENDING',
    } as never);

    tx.payment.findFirst.mockResolvedValueOnce(null as never);

    await expect(
      service.updateOrderShipment('order-1', 'shipment-1', {
        status: 'SHIPPED',
      }),
    ).rejects.toThrow(
      'Нельзя оформить отправление без подтверждённой полной оплаты заказа',
    );

    expect(tx.shipment.update).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('Shipment status policy', () => {
  it('allows ordinary shipment progression', () => {
    expect(canTransitionShipmentStatus('PENDING', 'SHIPPED')).toBe(true);

    expect(canTransitionShipmentStatus('SHIPPED', 'IN_TRANSIT')).toBe(true);

    expect(canTransitionShipmentStatus('IN_TRANSIT', 'OUT_FOR_DELIVERY')).toBe(
      true,
    );

    expect(canTransitionShipmentStatus('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(
      true,
    );
  });

  it('allows recovery from a delivery exception', () => {
    expect(canTransitionShipmentStatus('EXCEPTION', 'IN_TRANSIT')).toBe(true);

    expect(canTransitionShipmentStatus('EXCEPTION', 'RETURNED')).toBe(true);
  });

  it('prevents leaving terminal states', () => {
    expect(canTransitionShipmentStatus('DELIVERED', 'IN_TRANSIT')).toBe(false);

    expect(canTransitionShipmentStatus('RETURNED', 'SHIPPED')).toBe(false);

    expect(canTransitionShipmentStatus('DELIVERED', 'DELIVERED')).toBe(true);
  });
});

describe('Order cancellation policy with shipments', () => {
  it('denies cancellation after shipment starts', () => {
    const order = {
      status: 'PROCESSING',
      payments: [],
      shipments: [
        {
          status: 'IN_TRANSIT',
        },
      ],
    } as OrderRecord;

    expect(getOrderCancellationEligibility(order)).toEqual({
      allowed: false,
      reason: 'ALREADY_SHIPPED',
    });
  });

  it('uses the order lock before atomic cancellation', async () => {
    const { tx, prisma } = createHarness();

    tx.order.updateMany.mockResolvedValue({
      count: 0,
    } as never);

    const adapter = new CurrentStoreOrderAdapter(prisma);

    const result = await adapter.cancelOrder('user-1', 'order-1');

    expect(result).toBeNull();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order-1',
          userId: 'user-1',
        }),
        data: {
          status: 'CANCELLED',
        },
      }),
    );
  });
});
