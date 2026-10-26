import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import type { OrdersService } from '@/src/modules/orders/orders.service';

import type { OrderRecord } from '@/src/modules/orders/core/order-record.schema';

import type { OrderAction } from '@/src/support-agent/schemas/order-request.schema';

import { SupportAgentContextSchema } from '@/src/support-agent/context/support-agent-context.schema';

import { ClarificationNodeSchema } from '@/src/support-agent/schemas/clarification-response.schema';

import { SupportAgentState } from '../../support-agent.state';

import {
  createOrderAgentWorker,
  createConfirmOrderCancellationNode,
} from '../order-agent.worker';

const TRUSTED_USER_ID = 'trusted-user';

function createOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const date = new Date('2026-10-04T00:00:00.000Z');

  return {
    id: 'order-A',
    number: '10482',
    createdAt: date,
    updatedAt: date,
    userId: TRUSTED_USER_ID,
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
    ...overrides,
  };
}

function createState(
  action: OrderAction = 'CANCEL',
  orderNumber: string | null = null,
  orderId: string | null = null,
): typeof SupportAgentState.State {
  const query = 'Отмени мой заказ';

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
      reason: 'offline-interrupt-test',
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

function createConfig(threadId: string): LangGraphRunnableConfig {
  return {
    configurable: {
      thread_id: threadId,
    },
    context: {
      userId: TRUSTED_USER_ID,
    },
  } as LangGraphRunnableConfig;
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
      ends: [END, 'aggregateAnswer', 'confirmOrderCancellation'],
    })
    .addNode(
      'confirmOrderCancellation',
      createConfirmOrderCancellationNode(ordersService),
      {
        ends: [END, 'aggregateAnswer'],
      },
    )
    .addNode('aggregateAnswer', () => ({}))
    .addEdge(START, 'orderAgent')
    .addEdge('aggregateAnswer', END)
    .compile({
      checkpointer: new MemorySaver(),
    });
}

type TestGraph = ReturnType<typeof createTestGraph>;

type ResumeTarget =
  | typeof START
  | typeof END
  | 'orderAgent'
  | 'confirmOrderCancellation'
  | 'aggregateAnswer';

function selected(questionId: string) {
  return new Command<unknown, typeof SupportAgentState.Update, ResumeTarget>({
    resume: {
      kind: 'question_selected',
      questionId,
    },
  });
}

function allowCancellation(
  ordersService: jest.Mocked<OrdersService>,
  order: OrderRecord,
): void {
  ordersService.getOrderCancellationEligibility.mockResolvedValue({
    order,
    eligibility: {
      allowed: true,
      reason: 'ALLOWED',
    },
  });
}

async function interruptForConfirmation(
  graph: TestGraph,
  config: LangGraphRunnableConfig,
  orderNumber: string | null = null,
) {
  await graph.invoke(createState('CANCEL', orderNumber), config);

  const checkpoint = await graph.getState(config);

  expect(checkpoint.next).toContain('confirmOrderCancellation');

  expect(checkpoint.values.pendingOrderAction).not.toBeNull();

  const pendingInterrupt = checkpoint.tasks.flatMap(
    (task) => task.interrupts ?? [],
  )[0];

  expect(pendingInterrupt).toBeDefined();

  const question = ClarificationNodeSchema.parse(pendingInterrupt?.value);

  expect(question.kind).toBe('questions');
  expect(question.topic).toBe('orders');

  const optionId = (label: string): string => {
    const option = question.options.find((item) => item.label === label);

    if (!option) {
      throw new Error(`Confirmation option not found: ${label}`);
    }

    return option.id;
  };

  return {
    question: question.question,
    confirmId: optionId('Да, отменить'),
    declineId: optionId('Нет'),
  };
}

describe('OrderAgentWorker: offline LangGraph CANCEL interrupt/resume', () => {
  let ordersService: jest.Mocked<OrdersService>;

  beforeEach(() => {
    ordersService = createOrdersServiceMock();
  });

  it('NO: does not call cancelOrder after declining', async () => {
    const orderA = createOrder();

    ordersService.getRelevantUserOrder.mockResolvedValue(orderA);

    allowCancellation(ordersService, orderA);

    const graph = createTestGraph(ordersService);
    const config = createConfig('cancel-no');

    const prompt = await interruptForConfirmation(graph, config);

    expect(prompt.question).toContain('№10482');
    expect(prompt.question).not.toContain(orderA.id);

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();

    const result = await graph.invoke(selected(prompt.declineId), config);

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();

    expect(result.answer?.message).toContain('не отменяю');

    const checkpoint = await graph.getState(config);

    expect(checkpoint.values.pendingOrderAction).toBeNull();
  });

  it('YES: cancels precisely the order shown before interrupt', async () => {
    const orderA = createOrder();

    ordersService.getRelevantUserOrder.mockResolvedValue(orderA);

    allowCancellation(ordersService, orderA);

    ordersService.cancelOrder.mockResolvedValue(
      createOrder({
        id: orderA.id,
        status: 'CANCELLED',
      }),
    );

    const graph = createTestGraph(ordersService);
    const config = createConfig('cancel-yes');

    const prompt = await interruptForConfirmation(graph, config);

    expect(prompt.question).toContain('№10482');
    expect(prompt.question).not.toContain(orderA.id);

    const result = await graph.invoke(selected(prompt.confirmId), config);

    expect(ordersService.cancelOrder).toHaveBeenCalledTimes(1);

    expect(ordersService.cancelOrder).toHaveBeenCalledWith(
      TRUSTED_USER_ID,
      orderA.id,
    );

    expect(ordersService.getOrderCancellationEligibility).toHaveBeenCalledTimes(
      2,
    );

    expect(ordersService.getRelevantUserOrder).toHaveBeenCalledTimes(1);

    expect(result.answer?.message).toContain('№10482');
    expect(result.answer?.message).not.toContain(orderA.id);

    const checkpoint = await graph.getState(config);

    expect(checkpoint.values.pendingOrderAction).toBeNull();
  });

  it('TARGET CHANGED: cancels original A even when B becomes relevant', async () => {
    const orderA = createOrder({
      id: 'order-A',
      number: '10482',
      status: 'PROCESSING',
    });

    const orderB = createOrder({
      id: 'order-B',
      number: '10483',
      status: 'SHIPPED',
    });

    ordersService.getRelevantUserOrder
      .mockResolvedValueOnce(orderA)
      .mockResolvedValueOnce(orderB);

    ordersService.getOrderCancellationEligibility.mockImplementation(
      async (_userId: string, orderId: string) => {
        if (orderId === orderA.id) {
          return {
            order: orderA,
            eligibility: {
              allowed: true,
              reason: 'ALLOWED' as const,
            },
          };
        }

        return {
          order: orderB,
          eligibility: {
            allowed: false,
            reason: 'ALREADY_SHIPPED' as const,
          },
        };
      },
    );

    ordersService.cancelOrder.mockResolvedValue(
      createOrder({
        id: orderA.id,
        number: orderA.number,
        status: 'CANCELLED',
      }),
    );

    const graph = createTestGraph(ordersService);

    const config = createConfig('cancel-relevant-changed');

    const prompt = await interruptForConfirmation(graph, config);

    expect(prompt.question).toContain('№10482');
    expect(prompt.question).not.toContain(orderA.id);

    const result = await graph.invoke(selected(prompt.confirmId), config);

    expect(ordersService.getRelevantUserOrder).toHaveBeenCalledTimes(1);

    expect(ordersService.getOrderCancellationEligibility).toHaveBeenCalledTimes(
      2,
    );

    expect(
      ordersService.getOrderCancellationEligibility,
    ).not.toHaveBeenCalledWith(TRUSTED_USER_ID, orderB.id);

    expect(ordersService.cancelOrder).toHaveBeenCalledTimes(1);

    expect(ordersService.cancelOrder).toHaveBeenCalledWith(
      TRUSTED_USER_ID,
      orderA.id,
    );

    expect(result.answer?.message).toContain('№10482');
  });

  it('TAMPERING: rejects forged confirmation for another order', async () => {
    const orderA = createOrder();

    ordersService.getRelevantUserOrder.mockResolvedValue(orderA);

    allowCancellation(ordersService, orderA);

    const graph = createTestGraph(ordersService);

    const config = createConfig('cancel-tampered');

    const prompt = await interruptForConfirmation(graph, config);

    expect(prompt.question).toContain('№10482');

    const forgedId = 'order_cancel_confirm:order-B';

    expect(forgedId).not.toBe(prompt.confirmId);

    await expect(graph.invoke(selected(forgedId), config)).rejects.toThrow(
      'неизвестное или устаревшее подтверждение отмены',
    );

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();
  });

  it('STALE CONFIRMATION: rejects confirmation from an older operation', async () => {
    const orderA = createOrder();

    ordersService.getRelevantUserOrder.mockResolvedValue(orderA);

    allowCancellation(ordersService, orderA);

    const graph = createTestGraph(ordersService);

    const config = createConfig('cancel-stale-confirmation');

    const firstPrompt = await interruptForConfirmation(graph, config);

    await graph.invoke(selected(firstPrompt.declineId), config);

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();

    const secondPrompt = await interruptForConfirmation(graph, config);

    expect(secondPrompt.confirmId).not.toBe(firstPrompt.confirmId);

    await expect(
      graph.invoke(selected(firstPrompt.confirmId), config),
    ).rejects.toThrow('неизвестное или устаревшее подтверждение отмены');

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();
  });

  it('GET BY NUMBER: returns the requested order without exposing UUID', async () => {
    const orderA = createOrder();

    ordersService.getOrderByNumber.mockResolvedValue(orderA);

    const graph = createTestGraph(ordersService);

    const result = await graph.invoke(
      createState('GET', '10482'),
      createConfig('get-by-number'),
    );

    expect(ordersService.getOrderByNumber).toHaveBeenCalledWith(
      TRUSTED_USER_ID,
      '10482',
    );

    expect(ordersService.getOrderById).not.toHaveBeenCalled();

    expect(result.answer?.message).toContain('№10482');
    expect(result.answer?.message).not.toContain(orderA.id);
  });

  it('GET BY NUMBER: does not fall back to a different order', async () => {
    ordersService.getOrderByNumber.mockResolvedValue(null);

    const graph = createTestGraph(ordersService);

    const result = await graph.invoke(
      createState('GET', '99999'),
      createConfig('get-number-not-found'),
    );

    expect(result.answer?.message).toContain('№99999');
    expect(result.answer?.message).toContain('не найден');

    expect(ordersService.getRelevantUserOrder).not.toHaveBeenCalled();
  });

  it('CANCEL BY NUMBER: resolves public number but cancels internal ID', async () => {
    const orderA = createOrder({
      id: 'internal-order-id',
      number: '10482',
    });

    ordersService.getOrderByNumber.mockResolvedValue(orderA);

    allowCancellation(ordersService, orderA);

    ordersService.cancelOrder.mockResolvedValue(
      createOrder({
        id: orderA.id,
        number: orderA.number,
        status: 'CANCELLED',
      }),
    );

    const graph = createTestGraph(ordersService);
    const config = createConfig('cancel-by-number');

    const prompt = await interruptForConfirmation(graph, config, '10482');

    expect(prompt.question).toContain('№10482');
    expect(prompt.question).not.toContain(orderA.id);

    expect(ordersService.getOrderByNumber).toHaveBeenCalledWith(
      TRUSTED_USER_ID,
      '10482',
    );

    await graph.invoke(selected(prompt.confirmId), config);

    expect(ordersService.cancelOrder).toHaveBeenCalledTimes(1);

    expect(ordersService.cancelOrder).toHaveBeenCalledWith(
      TRUSTED_USER_ID,
      'internal-order-id',
    );

    expect(ordersService.getOrderByNumber).toHaveBeenCalledTimes(1);
  });
});
