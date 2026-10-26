import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import type { OrdersService } from '@/src/modules/orders/orders.service';

import type {
  OrderRecord,
  ShipmentRecord,
} from '@/src/modules/orders/core/order-record.schema';

import type { OrderAction } from '@/src/support-agent/schemas/order-request.schema';

import { SupportAgentContextSchema } from '@/src/support-agent/context/support-agent-context.schema';

import { SupportAgentState } from '../../support-agent.state';

import { createOrderAgentWorker } from '../order-agent.worker';

const USER_ID = 'trusted-user';

function createOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const date = new Date('2026-10-04T00:00:00.000Z');

  return {
    id: 'internal-order-id',
    number: '10482',
    createdAt: date,
    updatedAt: date,
    userId: USER_ID,
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
    deliveryProvider: 'SDEK',
    paymentType: 'CARD',
    payments: [],
    shipments: null,
    ...overrides,
  };
}

function createShipment(
  overrides: Partial<ShipmentRecord> = {},
): ShipmentRecord {
  return {
    id: 'shipment-1',
    provider: 'СДЭК',
    status: 'IN_TRANSIT',
    trackingNumber: 'TRACK-123',
    trackingUrl: 'https://example.com/track/TRACK-123',
    estimatedDeliveryAt: null,
    shippedAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

function createState(
  action: OrderAction,
  orderNumber: string | null = null,
  orderId: string | null = null,
): typeof SupportAgentState.State {
  const query = 'Информация о моём заказе';

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
        orderNumber,
      },
      clarificationTopic: null,
      handoffRequest: null,
      reason: 'offline-tracking-test',
    },
    activeAgent: null,
    productContext: null,
    productConsultationRecord: null,
    productWorkspace: null,
    executionMode: 'single',
    workerResults: [],
    pendingOrderAction: null,
    handoffRequest: null,
    handoff: null,
    answer: null,
  } as typeof SupportAgentState.State;
}

function createOrdersServiceMock(): jest.Mocked<OrdersService> {
  return {
    getUserOrders: jest.fn(),
    getOrderById: jest.fn(),
    getOrderByNumber: jest.fn(),
    getLatestUserOrder: jest.fn(),
    getRelevantUserOrder: jest.fn(),
    getOrderCancellationEligibility: jest.fn(),
    cancelOrder: jest.fn(),
  } as unknown as jest.Mocked<OrdersService>;
}

function createTestGraph(ordersService: OrdersService) {
  return new StateGraph(SupportAgentState, SupportAgentContextSchema)
    .addNode('orderAgent', createOrderAgentWorker(ordersService), {
      ends: [END],
    })
    .addEdge(START, 'orderAgent')
    .compile();
}

async function runOrderRequest(
  ordersService: OrdersService,
  action: OrderAction,
  orderNumber: string | null = null,
  orderId: string | null = null,
): Promise<string> {
  const graph = createTestGraph(ordersService);

  const config = {
    configurable: {
      thread_id: 'tracking-test',
    },
    context: {
      userId: USER_ID,
    },
  } as LangGraphRunnableConfig;

  const result = await graph.invoke(
    createState(action, orderNumber, orderId),
    config,
  );

  if (!result.answer) {
    throw new Error('Order Agent did not produce an answer');
  }

  return result.answer.message;
}

describe('OrderAgentWorker: STATUS and TRACKING', () => {
  let ordersService: jest.Mocked<OrdersService>;

  beforeEach(() => {
    ordersService = createOrdersServiceMock();
  });

  it('STATUS: returns status of order selected by public number', async () => {
    const order = createOrder();

    ordersService.getOrderByNumber.mockResolvedValue(order);

    const answer = await runOrderRequest(ordersService, 'STATUS', '10482');

    expect(ordersService.getOrderByNumber).toHaveBeenCalledWith(
      USER_ID,
      '10482',
    );

    expect(answer).toContain('№10482');
    expect(answer).toContain('обрабатывается');
    expect(answer).not.toContain(order.id);
  });

  it('STATUS: resolves relevant order when identifier is absent', async () => {
    const order = createOrder({
      status: 'SHIPPED',
    });

    ordersService.getRelevantUserOrder.mockResolvedValue(order);

    const answer = await runOrderRequest(ordersService, 'STATUS');

    expect(ordersService.getRelevantUserOrder).toHaveBeenCalledWith(USER_ID);

    expect(answer).toContain('№10482');
    expect(answer).toContain('отправлен');
  });

  it('TRACKING: reports unavailable source without inventing tracking data', async () => {
    const order = createOrder({
      shipments: null,
    });

    ordersService.getRelevantUserOrder.mockResolvedValue(order);

    const answer = await runOrderRequest(ordersService, 'TRACKING');

    expect(answer).toContain('№10482');
    expect(answer).toContain('SDEK');
    expect(answer).toContain('пока не подключено');
    expect(answer).toContain('недоступны');

    expect(answer).not.toContain('TRACK-123');
  });

  it('TRACKING: distinguishes an empty shipment list', async () => {
    const order = createOrder({
      shipments: [],
    });

    ordersService.getRelevantUserOrder.mockResolvedValue(order);

    const answer = await runOrderRequest(ordersService, 'TRACKING');

    expect(answer).toContain('Информации об отправлениях пока нет');
    expect(answer).not.toContain('пока не подключено');
  });

  it('TRACKING: displays actual shipment data', async () => {
    const shipment = createShipment({
      estimatedDeliveryAt: new Date('2026-10-20T00:00:00.000Z'),
    });

    const order = createOrder({
      shipments: [shipment],
    });

    ordersService.getOrderByNumber.mockResolvedValue(order);

    const answer = await runOrderRequest(ordersService, 'TRACKING', '10482');

    expect(ordersService.getOrderByNumber).toHaveBeenCalledWith(
      USER_ID,
      '10482',
    );

    expect(answer).toContain('Отправление 1');
    expect(answer).toContain('в пути');
    expect(answer).toContain('СДЭК');
    expect(answer).toContain('TRACK-123');
    expect(answer).toContain('example.com/track/TRACK-123');
    expect(answer).toContain('20.10.2026');

    expect(answer).not.toContain(order.id);
    expect(answer).not.toContain(shipment.id);
  });

  it('TRACKING: supports multiple shipments and missing ETA', async () => {
    const shipmentA = createShipment({
      id: 'shipment-A',
      trackingNumber: 'TRACK-A',
    });

    const shipmentB = createShipment({
      id: 'shipment-B',
      provider: 'Почта России',
      status: 'PENDING',
      trackingNumber: null,
      trackingUrl: null,
    });

    const order = createOrder({
      shipments: [shipmentA, shipmentB],
    });

    ordersService.getRelevantUserOrder.mockResolvedValue(order);

    const answer = await runOrderRequest(ordersService, 'TRACKING');

    expect(answer).toContain('Отправление 1');
    expect(answer).toContain('Отправление 2');
    expect(answer).toContain('TRACK-A');
    expect(answer).toContain('Почта России');

    expect(answer).not.toContain('Предполагаемая дата доставки');
    expect(answer).not.toContain(shipmentA.id);
    expect(answer).not.toContain(shipmentB.id);
  });

  it('STATUS: does not substitute another order when number is missing', async () => {
    ordersService.getOrderByNumber.mockResolvedValue(null);

    const answer = await runOrderRequest(ordersService, 'STATUS', '99999');

    expect(answer).toContain('№99999');
    expect(answer).toContain('не найден');

    expect(ordersService.getRelevantUserOrder).not.toHaveBeenCalled();
  });

  it('TRACKING: refuses conflicting order identifiers', async () => {
    const answer = await runOrderRequest(
      ordersService,
      'TRACKING',
      '10482',
      'another-order-id',
    );

    expect(answer).toContain('Не удалось однозначно определить заказ');

    expect(ordersService.getOrderByNumber).not.toHaveBeenCalled();
    expect(ordersService.getOrderById).not.toHaveBeenCalled();
    expect(ordersService.getRelevantUserOrder).not.toHaveBeenCalled();
  });
});
