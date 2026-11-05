import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { SupportCaseReason, SupportCaseStatus } from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { OrdersService } from '../orders.service';

import {
  getOrderCancellationPlan,
  type OrderCancellationRoute,
} from '../core/order-policy';

import type { OrderRecord } from '../core/order-record.schema';

export interface OrderCancellationCaseReceipt {
  caseId: string;
  orderId: string;
  orderNumber: string | null;
  route: OrderCancellationRoute;
  alreadyExists: boolean;
}

const ROUTE_DESCRIPTIONS: Record<OrderCancellationRoute, string> = {
  DIRECT_CANCEL: 'Автоматическая отмена без возврата оплаты',
  REFUND_BEFORE_SHIPPING: 'Отмена до отправки с возвратом оплаты',
  INTERCEPT_DELIVERY: 'Остановка или возврат отправления',
  FINALIZE_RETURN: 'Завершение возврата отправления продавцу',
  RETURN_AFTER_DELIVERY: 'Возврат товара после доставки',
  ALREADY_CANCELLED: 'Заказ уже отменён',
  MANUAL_REVIEW: 'Проверка обстоятельств отмены заказа',
};

function createCaseIssue(order: OrderRecord): string {
  const label = order.number ? `№${order.number}` : 'без публичного номера';

  return `Запрос на отмену или возврат заказа ${label}\nOrder ID: ${order.id}`;
}

function createCaseSummary(
  order: OrderRecord,
  route: OrderCancellationRoute,
): string {
  const paid = order.payments.some((payment) => payment.status === 'SUCCEEDED');

  const shipments =
    order.shipments == null
      ? 'Данные об отправлениях недоступны'
      : order.shipments.length === 0
      ? 'Зарегистрированных отправлений нет'
      : order.shipments
          .map((shipment) =>
            [
              shipment.provider ?? 'Перевозчик не указан',
              shipment.status,
              shipment.trackingNumber ?? 'Трек-номер отсутствует',
            ].join(' / '),
          )
          .join('; ');

  return [
    `Сценарий: ${ROUTE_DESCRIPTIONS[route]}`,
    `Статус заказа: ${order.status}`,
    `Успешная оплата: ${paid ? 'да' : 'нет'}`,
    `Отправления: ${shipments}`,
    'Покупатель запросил отмену или возврат.',
    'Отмена заказа и возврат средств ещё не подтверждены.',
  ].join('\n');
}

@Injectable()
export class OrderCancellationCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  async createOrGet(
    userId: string,
    chatId: string,
    orderId: string,
  ): Promise<OrderCancellationCaseReceipt> {
    const order = await this.ordersService.getOrderById(userId, orderId);

    const plan = getOrderCancellationPlan(order);

    if (plan.route === 'ALREADY_CANCELLED') {
      throw new ConflictException('Заказ уже отменён');
    }

    if (plan.route === 'DIRECT_CANCEL') {
      throw new ConflictException('Для заказа доступна прямая отмена');
    }

    const issue = createCaseIssue(order);

    return this.prisma.$transaction(async (tx) => {
      const chats = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Chat"
        WHERE "id" = ${chatId} AND "userId" = ${userId}
        FOR UPDATE
      `;

      if (chats.length !== 1) {
        throw new ForbiddenException('Нет доступа к указанному чату');
      }

      const existingCase = await tx.supportCase.findFirst({
        where: {
          userId,
          chatId,
          reason: SupportCaseReason.CUSTOMER_REQUEST,
          issue,

          status: {
            in: [
              SupportCaseStatus.WAITING_OPERATOR,
              SupportCaseStatus.IN_PROGRESS,
            ],
          },
        },

        orderBy: {
          createdAt: 'desc',
        },
      });

      if (existingCase) {
        return {
          caseId: existingCase.id,
          orderId: order.id,
          orderNumber: order.number ?? null,
          route: plan.route,
          alreadyExists: true,
        };
      }

      const supportCase = await tx.supportCase.create({
        data: {
          userId,
          chatId,
          reason: SupportCaseReason.CUSTOMER_REQUEST,
          issue,
          summary: createCaseSummary(order, plan.route),
          status: SupportCaseStatus.WAITING_OPERATOR,
        },
      });

      return {
        caseId: supportCase.id,
        orderId: order.id,
        orderNumber: order.number ?? null,
        route: plan.route,
        alreadyExists: false,
      };
    });
  }
}
