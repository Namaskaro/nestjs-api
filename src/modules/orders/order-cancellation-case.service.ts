import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { SupportCaseReason, SupportCaseStatus } from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { OrdersService } from './orders.service';

import {
  getOrderCancellationPlan,
  type OrderCancellationRoute,
} from './core/order-policy';

import type { OrderRecord } from './core/order-record.schema';

export interface OrderCancellationCaseReceipt {
  caseId: string;
  orderId: string;
  orderNumber: string | null;
  route: OrderCancellationRoute;
  alreadyExists: boolean;
}

const ROUTE_DESCRIPTIONS: Record<OrderCancellationRoute, string> = {
  DIRECT_CANCEL: 'Автоматическая отмена без возврата оплаты',

  REFUND_BEFORE_SHIPPING: 'Отмена до отправки с обработкой возврата оплаты',

  INTERCEPT_DELIVERY: 'Отказ от заказа с остановкой или возвратом отправления',

  FINALIZE_RETURN: 'Завершение возврата отправления продавцу',

  RETURN_AFTER_DELIVERY: 'Возврат товара после доставки покупателю',

  ALREADY_CANCELLED: 'Заказ уже отменён',

  MANUAL_REVIEW: 'Проверка обстоятельств отмены заказа',
};

function createCaseIssue(order: OrderRecord): string {
  const orderLabel = order.number
    ? `№${order.number}`
    : 'без публичного номера';

  return [
    `Запрос на отмену или возврат заказа ${orderLabel}`,
    `Order ID: ${order.id}`,
  ].join('\n');
}

function createCaseSummary(
  order: OrderRecord,
  route: OrderCancellationRoute,
): string {
  const hasSucceededPayment = order.payments.some(
    (payment) => payment.status === 'SUCCEEDED',
  );

  const shipmentDescription =
    order.shipments == null
      ? 'Источник данных об отправлениях недоступен'
      : order.shipments.length === 0
      ? 'Зарегистрированных отправлений нет'
      : order.shipments
          .map((shipment) => {
            const provider = shipment.provider ?? 'Перевозчик не указан';

            const trackingNumber =
              shipment.trackingNumber ?? 'Трек-номер отсутствует';

            return [provider, shipment.status, trackingNumber].join(' / ');
          })
          .join('; ');

  return [
    `Сценарий: ${ROUTE_DESCRIPTIONS[route]}`,
    `Статус заказа: ${order.status}`,
    `Успешная оплата: ${hasSucceededPayment ? 'да' : 'нет'}`,
    `Отправления: ${shipmentDescription}`,
    'Покупатель запросил отмену или возврат.',
    'Отмена заказа, остановка доставки и возврат денег',
    'этим обращением ещё не выполнены.',
  ].join('\n');
}

@Injectable()
export class OrderCancellationCaseService {
  constructor(
    private readonly prismaService: PrismaService,

    private readonly ordersService: OrdersService,
  ) {}

  public async createOrGet(
    userId: string,
    chatId: string,
    orderId: string,
  ): Promise<OrderCancellationCaseReceipt> {
    // Получаем заказ исключительно через userId
    // авторизованного пользователя.
    //
    // Таким образом, пользователь не может
    // зарегистрировать обращение по чужому заказу.

    const order = await this.ordersService.getOrderById(userId, orderId);

    const plan = getOrderCancellationPlan(order);

    if (plan.route === 'ALREADY_CANCELLED') {
      throw new ConflictException('Заказ уже отменён');
    }

    if (plan.route === 'DIRECT_CANCEL') {
      throw new ConflictException(
        'Для заказа доступна обычная автоматическая отмена',
      );
    }

    const issue = createCaseIssue(order);

    return this.prismaService.$transaction(async (tx) => {
      // Проверяем, что chatId существует
      // и действительно принадлежит userId.
      //
      // FOR UPDATE блокирует конкретный чат
      // на время проверки и записи обращения.

      const chats = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Chat"
        WHERE "id" = ${chatId}
          AND "userId" = ${userId}
        FOR UPDATE
      `;

      if (chats.length !== 1) {
        throw new ForbiddenException('Нет доступа к указанному чату');
      }

      // Ищем существующее активное обращение
      // по тому же заказу в этом чате.
      //
      // issue формируется сервером одинаково,
      // поэтому при повторном запросе совпадает.

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
