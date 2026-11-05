import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { AIMessage } from '@langchain/core/messages';

import {
  Command,
  END,
  interrupt,
  type GraphNode,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import { OrdersService } from '@/src/modules/orders/orders.service';

import { RefundService } from '@/src/modules/orders/refund/refund.service';

import { OrderCancellationCaseService } from '@/src/modules/orders/cancellation/order-cancellation-case.service';

import { getOrderCancellationPlan } from '@/src/modules/orders/core/order-policy';

import type {
  OrderRecord,
  ShipmentRecord,
} from '@/src/modules/orders/core/order-record.schema';

import type { OrderRequest } from '@/src/support-agent/schemas/order-request.schema';

import { SupportAgentContextSchema } from '@/src/support-agent/context/support-agent-context.schema';

import { ClarificationQuestionSelectedResumeSchema } from '@/src/support-agent/schemas/clarification-resume.schema';

import { ClarificationNodeSchema } from '@/src/support-agent/schemas/clarification-response.schema';

import {
  OrderAgentFinalAnswerSchema,
  OrderAnswerBlockSchema,
} from '@/src/support-agent/schemas/support-agent-answer.schema';

import {
  SupportAgentState,
  type SupportAgentStateType,
} from '../support-agent.state';

const ORDER_STATUS_LABELS: Record<OrderRecord['status'], string> = {
  DRAFT: 'оформляется',
  PENDING_PAYMENT: 'ожидает оплаты',
  PAID: 'оплачен',
  PROCESSING: 'обрабатывается',
  SHIPPED: 'отправлен',
  DELIVERED: 'доставлен',
  CANCELLED: 'отменён',
};

const SHIPMENT_STATUS_LABELS: Record<ShipmentRecord['status'], string> = {
  PENDING: 'подготавливается к отправке',
  SHIPPED: 'передано перевозчику',
  IN_TRANSIT: 'в пути',
  OUT_FOR_DELIVERY: 'передано курьеру для доставки',
  DELIVERED: 'доставлено',
  EXCEPTION: 'возникла проблема при доставке',
  RETURNED: 'возвращено отправителю',
  UNKNOWN: 'статус неизвестен',
};

const ORDER_CANCEL_DECLINE_ID = 'order_cancel_decline';
const ORDER_CANCEL_ANOTHER_ID = 'Выбрать другой заказ';
const ORDER_SELECTION_NEXT_ID = 'Показать ещё заказы';
const ORDER_SELECTION_PREVIOUS_ID = 'Предыдущие заказы';
const ORDER_SELECTION_DECLINE_ID = 'Не отменять заказ';
const ORDER_SELECTION_PAGE_SIZE = 5;

function orderLabel(order: OrderRecord): string {
  return order.number ? `Заказ №${order.number}` : 'Заказ';
}

function orderSummary(order: OrderRecord): string {
  return `${orderLabel(order)} — ${ORDER_STATUS_LABELS[order.status]}.`;
}

function shipmentSummary(shipment: ShipmentRecord, index: number): string {
  const lines = [
    `Отправление ${index + 1} — ${SHIPMENT_STATUS_LABELS[shipment.status]}.`,
  ];

  if (shipment.provider) {
    lines.push(`Перевозчик: ${shipment.provider}.`);
  }

  if (shipment.trackingNumber) {
    lines.push(`Трек-номер: ${shipment.trackingNumber}.`);
  }

  if (shipment.trackingUrl) {
    lines.push(`Отслеживание: ${shipment.trackingUrl}`);
  }

  if (shipment.estimatedDeliveryAt) {
    const date = shipment.estimatedDeliveryAt.toLocaleDateString('ru-RU', {
      timeZone: 'UTC',
    });

    lines.push(`Предполагаемая дата доставки: ${date}.`);
  }

  return lines.join('\n');
}

function trackingSummary(order: OrderRecord): string {
  const lines = [orderSummary(order)];

  if (order.shipments == null) {
    if (order.deliveryProvider) {
      lines.push(`Служба доставки заказа: ${order.deliveryProvider}.`);
    }

    lines.push(
      'Отслеживание отправлений для этого магазина пока не подключено.',
    );

    lines.push('Трек-номер и прогноз прибытия сейчас недоступны.');
  } else if (order.shipments.length === 0) {
    lines.push('Информации об отправлениях пока нет.');
  } else {
    lines.push(order.shipments.map(shipmentSummary).join('\n\n'));
  }

  return lines.join('\n\n');
}

function finishOrderAgent(
  state: SupportAgentStateType,
  message: string,
  clearPendingAction = false,
) {
  const pendingUpdate = clearPendingAction ? { pendingOrderAction: null } : {};

  if (state.executionMode === 'multi') {
    const block = OrderAnswerBlockSchema.parse({
      worker: 'order',
      data: { message },
    });

    return new Command({
      goto: 'aggregateAnswer',
      update: {
        workerResults: [block],
        ...pendingUpdate,
      },
    });
  }

  const answer = OrderAgentFinalAnswerSchema.parse({
    type: 'order_agent',
    message,
  });

  return new Command({
    goto: END,
    update: {
      activeAgent: 'orderAgent' as const,
      answer,
      messages: [new AIMessage(answer.message)],
      ...pendingUpdate,
    },
  });
}

async function resolveTargetOrder(
  ordersService: OrdersService,
  userId: string,
  request: OrderRequest,
): Promise<OrderRecord | null> {
  if (request.orderNumber) {
    return ordersService.getOrderByNumber(userId, request.orderNumber);
  }

  if (request.orderId) {
    return ordersService.getOrderById(userId, request.orderId);
  }

  return ordersService.getRelevantUserOrder(userId);
}

function missingOrderMessage(request: OrderRequest): string {
  if (request.orderNumber) {
    return `Заказ №${request.orderNumber} не найден среди ваших заказов.`;
  }

  if (request.orderId) {
    return 'Запрошенный заказ не найден среди ваших заказов.';
  }

  return 'У вас пока нет заказов.';
}

function isCancellationCandidate(order: OrderRecord): boolean {
  return (
    order.status === 'PAID' ||
    order.status === 'PROCESSING' ||
    order.status === 'SHIPPED' ||
    order.status === 'DELIVERED'
  );
}

function cancellationOptions(orders: OrderRecord[]): OrderRecord[] {
  return orders
    .filter((order) => isCancellationCandidate(order) && Boolean(order.number))
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        Number(right.number) - Number(left.number),
    );
}

function cancellationOptionLabel(order: OrderRecord): string {
  const date = order.createdAt.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const item = order.items[0]?.title;

  return [
    orderLabel(order),
    `${date} МСК`,
    `${order.finalAmount.toLocaleString('ru-RU')} ₽`,
    ORDER_STATUS_LABELS[order.status],
    item,
  ]
    .filter(Boolean)
    .join(' · ');
}

function selectCancellationOrder(orders: OrderRecord[]): OrderRecord | null {
  const candidates = cancellationOptions(orders);

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  let page = 0;

  while (true) {
    const start = page * ORDER_SELECTION_PAGE_SIZE;

    const visibleOrders = candidates.slice(
      start,
      start + ORDER_SELECTION_PAGE_SIZE,
    );

    const options = visibleOrders.map((order) => ({
      id: orderLabel(order),
      label: cancellationOptionLabel(order),
    }));

    if (page > 0) {
      options.push({
        id: ORDER_SELECTION_PREVIOUS_ID,
        label: '← Предыдущие заказы',
      });
    }

    if (start + ORDER_SELECTION_PAGE_SIZE < candidates.length) {
      options.push({
        id: ORDER_SELECTION_NEXT_ID,
        label: 'Показать ещё заказы →',
      });
    }

    options.push({
      id: ORDER_SELECTION_DECLINE_ID,
      label: 'Не отменять заказ',
    });

    const selected = ClarificationQuestionSelectedResumeSchema.parse(
      interrupt(
        ClarificationNodeSchema.parse({
          kind: 'questions',
          question: 'Какой именно заказ хотите отменить?',
          topic: 'orders',
          options,
        }),
      ),
    );

    if (selected.questionId === ORDER_SELECTION_DECLINE_ID) {
      return null;
    }

    if (
      selected.questionId === ORDER_SELECTION_NEXT_ID &&
      start + ORDER_SELECTION_PAGE_SIZE < candidates.length
    ) {
      page++;
      continue;
    }

    if (selected.questionId === ORDER_SELECTION_PREVIOUS_ID && page > 0) {
      page--;
      continue;
    }

    const order = visibleOrders.find(
      (candidate) => orderLabel(candidate) === selected.questionId,
    );

    if (!order) {
      throw new Error('OrderAgent: выбранный заказ отсутствует в списке');
    }

    return order;
  }
}

function cancellationAcceptedMessage(order: OrderRecord): string {
  return `${orderLabel(
    order,
  )}: заявка на отмену принята. Возврат денежных средств будет обработан. После оформления возврата срок зачисления зависит от банка.`;
}

export function createOrderAgentWorker(
  ordersService: OrdersService,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    const { userId } = SupportAgentContextSchema.parse(config.context);

    const request = state.requestRouter?.orderRequest;

    if (!request) {
      throw new Error('OrderAgentWorker: отсутствует orderRequest');
    }

    await dispatchCustomEvent(
      'assistant_status',
      { status: 'CHECKING_ORDER' },
      config,
    );

    const finish = (message: string) => finishOrderAgent(state, message);

    if (request.action === 'LIST') {
      const orders = await ordersService.getUserOrders(userId);

      return finish(
        orders.length === 0
          ? 'У вас пока нет заказов.'
          : [
              `У вас ${orders.length} заказ(а/ов):`,
              ...orders.map(
                (order, index) => `${index + 1}. ${orderSummary(order)}`,
              ),
            ].join('\n'),
      );
    }

    if (request.action === 'LATEST') {
      const order = await ordersService.getLatestUserOrder(userId);

      return finish(order ? orderSummary(order) : 'У вас пока нет заказов.');
    }

    if (request.action === 'RELEVANT') {
      const order = await ordersService.getRelevantUserOrder(userId);

      return finish(order ? orderSummary(order) : 'У вас пока нет заказов.');
    }

    if (request.orderNumber && request.orderId) {
      return finish(
        'Не удалось однозначно определить заказ. Укажите один номер заказа.',
      );
    }

    if (
      request.action === 'GET' ||
      request.action === 'STATUS' ||
      request.action === 'TRACKING'
    ) {
      const order = await resolveTargetOrder(ordersService, userId, request);

      if (!order) {
        return finish(missingOrderMessage(request));
      }

      return finish(
        request.action === 'TRACKING'
          ? trackingSummary(order)
          : orderSummary(order),
      );
    }

    if (request.action === 'CANCEL') {
      let targetOrder: OrderRecord | null;

      if (request.orderNumber || request.orderId) {
        targetOrder = await resolveTargetOrder(ordersService, userId, request);
      } else {
        const orders = await ordersService.getUserOrders(userId);

        const candidates = cancellationOptions(orders);

        if (candidates.length === 0) {
          return finish('У вас нет оплаченных заказов для отмены.');
        }

        targetOrder = selectCancellationOrder(orders);

        if (!targetOrder) {
          return finish('Хорошо, заказ не отменяю.');
        }

        targetOrder = await ordersService.getOrderById(userId, targetOrder.id);
      }

      if (!targetOrder) {
        return finish(
          request.orderNumber || request.orderId
            ? missingOrderMessage(request)
            : 'У вас нет заказа, который можно отменить.',
        );
      }

      if (getOrderCancellationPlan(targetOrder).route === 'ALREADY_CANCELLED') {
        return finish(`${orderLabel(targetOrder)} уже отменён.`);
      }

      return new Command({
        goto: 'confirmOrderCancellation',
        update: {
          pendingOrderAction: {
            action: 'CANCEL' as const,
            orderId: targetOrder.id,
            orderNumber: targetOrder.number ?? null,
            userId,
            confirmationId: `order_cancel_confirm:${randomUUID()}`,
          },
        },
      });
    }

    throw new Error(
      `OrderAgentWorker: неподдерживаемое действие ${request.action}`,
    );
  };
}

export function createConfirmOrderCancellationNode(
  ordersService: OrdersService,
  refundService: RefundService,
  cancellationCaseService: OrderCancellationCaseService,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    const { userId } = SupportAgentContextSchema.parse(config.context);

    const chatId = config.configurable?.thread_id;
    const pendingAction = state.pendingOrderAction;

    if (typeof chatId !== 'string' || chatId.length === 0) {
      throw new Error(
        'ConfirmOrderCancellation: отсутствует идентификатор чата',
      );
    }

    if (!pendingAction || pendingAction.action !== 'CANCEL') {
      throw new Error('ConfirmOrderCancellation: нет ожидающей отмены');
    }

    if (pendingAction.userId !== userId) {
      throw new Error('ConfirmOrderCancellation: пользователь не совпадает');
    }

    const finish = (message: string) => finishOrderAgent(state, message, true);

    let selectedOrder = await ordersService.getOrderById(
      userId,
      pendingAction.orderId,
    );

    while (true) {
      const candidates = cancellationOptions(
        await ordersService.getUserOrders(userId),
      );

      const confirmationId = `${pendingAction.confirmationId}:${selectedOrder.id}`;

      const options = [
        {
          id: confirmationId,
          label: 'Да, отменить',
        },

        ...(candidates.length > 1
          ? [
              {
                id: ORDER_CANCEL_ANOTHER_ID,
                label: ORDER_CANCEL_ANOTHER_ID,
              },
            ]
          : []),

        {
          id: ORDER_CANCEL_DECLINE_ID,
          label: 'Нет',
        },
      ];

      const selected = ClarificationQuestionSelectedResumeSchema.parse(
        interrupt(
          ClarificationNodeSchema.parse({
            kind: 'questions',
            question: `Вы действительно хотите отменить ${orderLabel(
              selectedOrder,
            )}?`,
            topic: 'orders',
            options,
          }),
        ),
      );

      if (selected.questionId === ORDER_CANCEL_DECLINE_ID) {
        return finish('Хорошо, заказ не отменяю.');
      }

      if (
        selected.questionId === ORDER_CANCEL_ANOTHER_ID &&
        candidates.length > 1
      ) {
        const otherOrder = selectCancellationOrder(candidates);

        if (!otherOrder) {
          return finish('Хорошо, заказ не отменяю.');
        }

        selectedOrder = await ordersService.getOrderById(userId, otherOrder.id);

        continue;
      }

      if (selected.questionId !== confirmationId) {
        throw new Error(
          'ConfirmOrderCancellation: неизвестное или устаревшее подтверждение',
        );
      }

      const order = await ordersService.getOrderById(userId, selectedOrder.id);

      const plan = getOrderCancellationPlan(order);

      if (plan.route === 'ALREADY_CANCELLED') {
        return finish(`${orderLabel(order)} уже отменён.`);
      }

      if (plan.route === 'DIRECT_CANCEL') {
        const cancelled = await ordersService.cancelOrder(userId, order.id);

        return finish(`${orderLabel(cancelled)} отменён.`);
      }

      const receipt = await cancellationCaseService.createOrGet(
        userId,
        chatId,
        order.id,
      );

      if (plan.route === 'REFUND_BEFORE_SHIPPING') {
        try {
          await refundService.cancelAndRefund(userId, order.id, receipt.caseId);
        } catch (error) {
          if (!(error instanceof ConflictException)) {
            throw error;
          }
        }
      }

      return finish(cancellationAcceptedMessage(order));
    }
  };
}
