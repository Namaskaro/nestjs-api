import { randomUUID } from 'node:crypto';

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

function orderLabel(order: OrderRecord): string {
  if (order.number) {
    return `Заказ №${order.number}`;
  }

  return 'Заказ';
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

  const shipments = order.shipments;

  if (shipments == null) {
    if (order.deliveryProvider) {
      lines.push(`Служба доставки заказа: ${order.deliveryProvider}.`);
    }

    lines.push(
      'Отслеживание отправлений для этого магазина пока не подключено.',
    );

    lines.push('Трек-номер и прогноз прибытия сейчас недоступны.');

    return lines.join('\n');
  }

  if (shipments.length === 0) {
    lines.push('Информации об отправлениях пока нет.');

    return lines.join('\n');
  }

  lines.push(
    shipments
      .map((shipment, index) => shipmentSummary(shipment, index))
      .join('\n\n'),
  );

  return lines.join('\n\n');
}

function cancellationDeniedMessage(reason: string): string {
  switch (reason) {
    case 'ALREADY_CANCELLED':
      return 'Заказ уже отменён.';

    case 'ALREADY_SHIPPED':
      return 'Заказ уже отправлен, поэтому обычная отмена недоступна.';

    case 'ALREADY_DELIVERED':
      return 'Заказ уже доставлен, поэтому отменить его нельзя.';

    case 'REFUND_REQUIRED':
      return 'Заказ уже оплачен. Для него требуется отдельный процесс возврата денег.';

    default:
      return 'Этот заказ сейчас нельзя отменить.';
  }
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
      data: {
        message,
      },
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

export function createOrderAgentWorker(
  ordersService: OrdersService,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    const context = SupportAgentContextSchema.parse(config.context);
    const userId = context.userId;
    const request = state.requestRouter?.orderRequest;

    if (!request) {
      throw new Error('OrderAgentWorker: отсутствует orderRequest');
    }

    await dispatchCustomEvent(
      'assistant_status',
      {
        status: 'CHECKING_ORDER',
      },
      config,
    );

    const finish = (message: string) => finishOrderAgent(state, message);

    if (request.action === 'LIST') {
      const orders = await ordersService.getUserOrders(userId);

      if (!orders.length) {
        return finish('У вас пока нет заказов.');
      }

      const message = [
        `У вас ${orders.length} заказ(а/ов):`,
        ...orders.map((order, index) => `${index + 1}. ${orderSummary(order)}`),
      ].join('\n');

      return finish(message);
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

      if (request.action === 'TRACKING') {
        return finish(trackingSummary(order));
      }

      return finish(orderSummary(order));
    }

    if (request.action === 'CANCEL') {
      const targetOrder = await resolveTargetOrder(
        ordersService,
        userId,
        request,
      );

      if (!targetOrder) {
        return finish(
          request.orderNumber || request.orderId
            ? missingOrderMessage(request)
            : 'У вас нет заказа, который можно отменить.',
        );
      }

      const { eligibility } =
        await ordersService.getOrderCancellationEligibility(
          userId,
          targetOrder.id,
        );

      if (!eligibility.allowed) {
        return finish(cancellationDeniedMessage(eligibility.reason));
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
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    const context = SupportAgentContextSchema.parse(config.context);
    const userId = context.userId;

    const pendingAction = state.pendingOrderAction;

    if (!pendingAction || pendingAction.action !== 'CANCEL') {
      throw new Error(
        'ConfirmOrderCancellation: отсутствует ожидающая операция отмены',
      );
    }

    if (pendingAction.userId !== userId) {
      throw new Error(
        'ConfirmOrderCancellation: пользователь не соответствует ожидающей операции',
      );
    }

    const finish = (message: string) => finishOrderAgent(state, message, true);

    const orderId = pendingAction.orderId;

    const displayOrder = pendingAction.orderNumber
      ? `заказ №${pendingAction.orderNumber}`
      : 'выбранный заказ';

    const confirmationPayload = ClarificationNodeSchema.parse({
      kind: 'questions',
      question: `Вы действительно хотите отменить ${displayOrder}?`,
      topic: 'orders',
      options: [
        {
          id: pendingAction.confirmationId,
          label: 'Да, отменить',
        },
        {
          id: ORDER_CANCEL_DECLINE_ID,
          label: 'Нет',
        },
      ],
    });

    const rawResumeValue = interrupt(confirmationPayload);

    const resumeValue =
      ClarificationQuestionSelectedResumeSchema.parse(rawResumeValue);

    if (resumeValue.questionId === ORDER_CANCEL_DECLINE_ID) {
      return finish('Хорошо, заказ не отменяю.');
    }

    if (resumeValue.questionId !== pendingAction.confirmationId) {
      throw new Error(
        'ConfirmOrderCancellation: неизвестное или устаревшее подтверждение отмены',
      );
    }

    const { eligibility } = await ordersService.getOrderCancellationEligibility(
      userId,
      orderId,
    );

    if (!eligibility.allowed) {
      return finish(cancellationDeniedMessage(eligibility.reason));
    }

    const cancelledOrder = await ordersService.cancelOrder(userId, orderId);

    return finish(`${orderLabel(cancelledOrder)} отменён.`);
  };
}
