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

import type { OrderRecord } from '@/src/modules/orders/core/order-record.schema';

import { SupportAgentContextSchema } from '@/src/support-agent/context/support-agent-context.schema';

import { ClarificationQuestionSelectedResumeSchema } from '@/src/support-agent/schemas/clarification-resume.schema';

import { ClarificationNodeSchema } from '@/src/support-agent/schemas/clarification-response.schema';

import {
  OrderAgentFinalAnswerSchema,
  OrderAnswerBlockSchema,
} from '@/src/support-agent/schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

const ORDER_STATUS_LABELS: Record<OrderRecord['status'], string> = {
  DRAFT: 'оформляется',
  PENDING_PAYMENT: 'ожидает оплаты',
  PAID: 'оплачен',
  PROCESSING: 'обрабатывается',
  SHIPPED: 'отправлен',
  DELIVERED: 'доставлен',
  CANCELLED: 'отменён',
};

function orderLabel(order: OrderRecord): string {
  return `Заказ ${order.id}`;
}

function orderSummary(order: OrderRecord): string {
  return `${orderLabel(order)} — ${ORDER_STATUS_LABELS[order.status]}.`;
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

    const finish = (message: string) => {
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
        },
      });
    };

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

    if (request.action === 'GET') {
      if (!request.orderId) {
        const order = await ordersService.getRelevantUserOrder(userId);

        return finish(order ? orderSummary(order) : 'У вас пока нет заказов.');
      }

      const order = await ordersService.getOrderById(userId, request.orderId);

      return finish(orderSummary(order));
    }

    if (request.action === 'LATEST') {
      const order = await ordersService.getLatestUserOrder(userId);

      return finish(order ? orderSummary(order) : 'У вас пока нет заказов.');
    }

    if (request.action === 'RELEVANT') {
      const order = await ordersService.getRelevantUserOrder(userId);

      return finish(order ? orderSummary(order) : 'У вас пока нет заказов.');
    }

    if (request.action === 'CANCEL') {
      const targetOrder = request.orderId
        ? await ordersService.getOrderById(userId, request.orderId)
        : await ordersService.getRelevantUserOrder(userId);

      if (!targetOrder) {
        return finish('У вас нет заказа, который можно отменить.');
      }

      const { eligibility } =
        await ordersService.getOrderCancellationEligibility(
          userId,
          targetOrder.id,
        );

      if (!eligibility.allowed) {
        return finish(cancellationDeniedMessage(eligibility.reason));
      }

      const confirmId = `order_cancel_confirm:${targetOrder.id}`;

      const interruptPayload = ClarificationNodeSchema.parse({
        kind: 'questions',
        question: `Вы действительно хотите отменить ${orderLabel(
          targetOrder,
        )}?`,
        topic: 'orders',
        options: [
          {
            id: confirmId,
            label: 'Да, отменить',
          },
          {
            id: 'order_cancel_decline',
            label: 'Нет',
          },
        ],
      });

      const rawResumeValue = interrupt(interruptPayload);

      const resumeValue =
        ClarificationQuestionSelectedResumeSchema.parse(rawResumeValue);

      if (resumeValue.questionId === 'order_cancel_decline') {
        return finish('Хорошо, заказ не отменяю.');
      }

      if (!resumeValue.questionId.startsWith('order_cancel_confirm:')) {
        throw new Error(
          'OrderAgentWorker: получен неизвестный ответ подтверждения отмены',
        );
      }

      const confirmedOrderId = resumeValue.questionId.slice(
        'order_cancel_confirm:'.length,
      );

      if (!confirmedOrderId) {
        throw new Error(
          'OrderAgentWorker: отсутствует orderId подтверждённой отмены',
        );
      }

      const cancelledOrder = await ordersService.cancelOrder(
        userId,
        confirmedOrderId,
      );

      return finish(`${orderLabel(cancelledOrder)} отменён.`);
    }

    throw new Error(
      `OrderAgentWorker: неподдерживаемое действие ${request.action}`,
    );
  };
}
