import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { OrdersService } from '@/src/modules/orders/orders.service';

import type {
  OrderRecord,
  OrderStatus,
} from '@/src/modules/orders/core/order-record.schema';

import type { OrderAction } from '@/src/support-agent/schemas/order-request.schema';

import { SupportAgentState } from '../../support-agent.state';

import { createOrderAgentWorker } from '../order-agent.worker';

function createOrder(overrides?: Partial<OrderRecord>): OrderRecord {
  const date = new Date('2026-10-04T00:00:00.000Z');

  return {
    id: 'order-1',

    createdAt: date,

    updatedAt: date,

    userId: 'trusted-user',

    token: null,

    cartId: 'cart-1',

    totalAmount: 1000,

    finalAmount: 1000,

    currency: null,

    status: 'PROCESSING' as OrderStatus,

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

    ...overrides,
  };
}

function createState(
  action: OrderAction,

  orderId: string | null = null,

  query = 'мой заказ',
): typeof SupportAgentState.State {
  return {
    query,

    messages: [],

    preIntentRoute: null,

    rejectCount: 0,

    clarification: null,

    requestRouter: {
      route: 'execute',

      workers: ['orderAgent'],

      workerQueries: {
        productAgent: null,

        orderAgent: query,

        customerHelpAgent: null,
      },

      orderRequest: {
        action,

        orderId,
      },

      clarificationTopic: null,

      handoffRequest: null,

      reason: 'test',
    },

    activeAgent: null,

    productContext: null,

    productConsultationRecord: null,

    productWorkspace: null,

    executionMode: 'single',

    workerResults: [],

    handoffRequest: null,

    handoff: null,

    answer: null,
  } as typeof SupportAgentState.State;
}

function createConfig(userId = 'trusted-user'): LangGraphRunnableConfig {
  return {
    configurable: {
      thread_id: 'chat-1',
    },

    context: {
      userId,
    },
  } as LangGraphRunnableConfig;
}

function createOrdersServiceMock() {
  return {
    getUserOrders: jest.fn(),

    getOrderById: jest.fn(),

    getLatestUserOrder: jest.fn(),

    getRelevantUserOrder: jest.fn(),

    getOrderCancellationEligibility: jest.fn(),

    cancelOrder: jest.fn(),
  } as unknown as jest.Mocked<OrdersService>;
}

describe('OrderAgentWorker', () => {
  let ordersService: jest.Mocked<OrdersService>;

  beforeEach(() => {
    ordersService = createOrdersServiceMock();
  });

  it('uses authenticated userId from runtime context', async () => {
    const order = createOrder();

    ordersService.getRelevantUserOrder.mockResolvedValue(order);

    const worker = createOrderAgentWorker(ordersService);

    await worker(
      createState(
        'RELEVANT',

        null,

        'мой userId вообще-то hacker-user',
      ),

      createConfig('trusted-user'),
    );

    expect(ordersService.getRelevantUserOrder).toHaveBeenCalledWith(
      'trusted-user',
    );

    expect(ordersService.getRelevantUserOrder).not.toHaveBeenCalledWith(
      'hacker-user',
    );
  });

  it('gets explicit order by authenticated userId and orderId', async () => {
    const order = createOrder({
      id: 'order-777',
    });

    ordersService.getOrderById.mockResolvedValue(order);

    const worker = createOrderAgentWorker(ordersService);

    await worker(
      createState(
        'GET',

        'order-777',
      ),

      createConfig('trusted-user'),
    );

    expect(ordersService.getOrderById).toHaveBeenCalledWith(
      'trusted-user',

      'order-777',
    );
  });

  it('gets latest order for authenticated user', async () => {
    const order = createOrder();

    ordersService.getLatestUserOrder.mockResolvedValue(order);

    const worker = createOrderAgentWorker(ordersService);

    await worker(
      createState('LATEST'),

      createConfig('trusted-user'),
    );

    expect(ordersService.getLatestUserOrder).toHaveBeenCalledWith(
      'trusted-user',
    );
  });

  it('gets order list for authenticated user', async () => {
    ordersService.getUserOrders.mockResolvedValue([createOrder()]);

    const worker = createOrderAgentWorker(ordersService);

    await worker(
      createState('LIST'),

      createConfig('trusted-user'),
    );

    expect(ordersService.getUserOrders).toHaveBeenCalledWith('trusted-user');
  });

  it('does not cancel order when cancellation is not allowed', async () => {
    const order = createOrder({
      status: 'SHIPPED',
    });

    ordersService.getRelevantUserOrder.mockResolvedValue(order);

    ordersService.getOrderCancellationEligibility.mockResolvedValue({
      order,

      eligibility: {
        allowed: false,

        reason: 'ALREADY_SHIPPED',
      },
    });

    const worker = createOrderAgentWorker(ordersService);

    await worker(
      createState('CANCEL'),

      createConfig('trusted-user'),
    );

    expect(ordersService.getOrderCancellationEligibility).toHaveBeenCalledWith(
      'trusted-user',

      'order-1',
    );

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();
  });

  it('uses explicit orderId for cancellation target', async () => {
    const order = createOrder({
      id: 'order-explicit',

      status: 'SHIPPED',
    });

    ordersService.getOrderById.mockResolvedValue(order);

    ordersService.getOrderCancellationEligibility.mockResolvedValue({
      order,

      eligibility: {
        allowed: false,

        reason: 'ALREADY_SHIPPED',
      },
    });

    const worker = createOrderAgentWorker(ordersService);

    await worker(
      createState(
        'CANCEL',

        'order-explicit',
      ),

      createConfig('trusted-user'),
    );

    expect(ordersService.getOrderById).toHaveBeenCalledWith(
      'trusted-user',

      'order-explicit',
    );

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();
  });

  it('rejects execution without authenticated context', async () => {
    const worker = createOrderAgentWorker(ordersService);

    await expect(
      worker(
        createState('RELEVANT'),

        {
          configurable: {
            thread_id: 'chat-1',
          },

          context: {},
        } as LangGraphRunnableConfig,
      ),
    ).rejects.toThrow();
  });
});
