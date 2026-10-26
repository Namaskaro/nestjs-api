import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '@/src/core/prisma/prisma.service';

import type { OrderRecord } from '../core/order-record.schema';

import type { OrderPort } from '../ports/order.port';

import { OrdersService } from '../orders.service';

const order: OrderRecord = {
  id: 'order-1',

  number: '10482',

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

  shipments: [],
};

/**
 * Полностью типизированный mock OrderPort.
 *
 * Все методы соответствуют реальному интерфейсу.
 *
 * Если OrderPort расширится, TypeScript потребует
 * добавить новый метод и сюда.
 */
function createOrderPortMock(): jest.Mocked<OrderPort> {
  return {
    getUserOrders: jest.fn<OrderPort['getUserOrders']>(),

    getOrderById: jest.fn<OrderPort['getOrderById']>(),

    getOrderByNumber: jest.fn<OrderPort['getOrderByNumber']>(),

    getLatestUserOrder: jest.fn<OrderPort['getLatestUserOrder']>(),

    cancelOrder: jest.fn<OrderPort['cancelOrder']>(),
  };
}

describe('OrdersService', () => {
  it('selects relevant order using core policy', async () => {
    const port = createOrderPortMock();

    port.getUserOrders.mockResolvedValue([order]);

    const service = new OrdersService(port, {} as PrismaService);

    await expect(service.getRelevantUserOrder('user-1')).resolves.toEqual(
      order,
    );

    expect(port.getUserOrders).toHaveBeenCalledWith('user-1');
  });

  it('cancels eligible order through port', async () => {
    const cancellableOrder: OrderRecord = {
      ...order,

      status: 'DRAFT',

      payments: [],

      shipments: [],
    };

    const cancelledOrder: OrderRecord = {
      ...cancellableOrder,

      status: 'CANCELLED',
    };

    const port = createOrderPortMock();

    port.getOrderById.mockResolvedValue(cancellableOrder);

    port.cancelOrder.mockResolvedValue(cancelledOrder);

    const service = new OrdersService(port, {} as PrismaService);

    await expect(service.cancelOrder('user-1', 'order-1')).resolves.toEqual(
      cancelledOrder,
    );

    expect(port.getOrderById).toHaveBeenCalledWith('user-1', 'order-1');

    expect(port.cancelOrder).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('does not automatically cancel PROCESSING without payment', async () => {
    const port = createOrderPortMock();

    port.getOrderById.mockResolvedValue(order);

    const service = new OrdersService(port, {} as PrismaService);

    await expect(service.cancelOrder('user-1', 'order-1')).rejects.toThrow(
      'Этот заказ нельзя отменить',
    );

    expect(port.cancelOrder).not.toHaveBeenCalled();
  });
});
