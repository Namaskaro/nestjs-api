import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { createHash } from 'node:crypto';

import {
  OrderStatus,
  PaymentStatus,
  PaymentType,
  Prisma,
} from '@/prisma/generated';

import { PrismaService } from '../core/prisma/prisma.service';

import {
  YookassaPaymentResponse,
  YookassaService,
} from './yookassa/yookassa.service';

const RESERVATION_PREFIX = 'reservation:';

const IDEMPOTENCE_RETRY_LIMIT_MS = 23 * 60 * 60 * 1000;

type PaymentAdmission =
  | {
      kind: 'EXISTING';
      paymentId: number;
      providerPaymentId: string;
      status: PaymentStatus;
      confirmationUrl: string;
    }
  | {
      kind: 'RESERVED';
      paymentId: number;
      placeholderId: string;
      idempotenceKey: string;
      amount: number;
    };

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readConfirmationUrl(
  rawResponse: Prisma.JsonValue | null,
): string | null {
  if (!isJsonObject(rawResponse)) {
    return null;
  }

  const confirmation = rawResponse.confirmation;

  if (
    typeof confirmation !== 'object' ||
    confirmation === null ||
    Array.isArray(confirmation)
  ) {
    return null;
  }

  return typeof confirmation.confirmation_url === 'string'
    ? confirmation.confirmation_url
    : null;
}

function readReservationKey(
  rawResponse: Prisma.JsonValue | null,
): string | null {
  if (!isJsonObject(rawResponse)) {
    return null;
  }

  if (
    rawResponse.phase !== 'CREATING' ||
    typeof rawResponse.idempotenceKey !== 'string'
  ) {
    return null;
  }

  return rawResponse.idempotenceKey;
}

function createPaymentIdempotenceKey(
  orderId: string,
  amount: number,
  failedAttempts: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation: 'create_payment',
        orderId,
        amount,
        failedAttempts,
      }),
    )
    .digest('hex');
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly yookassaService: YookassaService,
  ) {}

  public async createPayment(userId: string, orderId: string) {
    // Быстрая проверка до транзакции.
    // Повторно проверяем условия уже
    // под блокировкой строки Order.

    const initialOrder = await this.prismaService.order.findFirstOrThrow({
      where: {
        id: orderId,
        userId,
      },
    });

    if (initialOrder.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Заказ не готов к оплате');
    }

    if (initialOrder.paymentType !== PaymentType.CARD) {
      throw new BadRequestException('Для заказа доступна только онлайн-оплата');
    }

    const admission = await this.prismaService.$transaction(
      async (tx): Promise<PaymentAdmission> => {
        // Блокируем именно строку заказа.
        //
        // Создание платежа и отмена должны
        // использовать одну и ту же блокировку.

        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "order"
            WHERE "id" = ${orderId}
              AND "userId" = ${userId}
            FOR UPDATE
          `;

        if (lockedRows.length !== 1) {
          throw new ConflictException('Заказ недоступен для оплаты');
        }

        const order = await tx.order.findFirstOrThrow({
          where: {
            id: orderId,
            userId,
          },
        });

        // Состояние могло измениться между
        // первой проверкой и блокировкой.

        if (order.status !== OrderStatus.PENDING_PAYMENT) {
          throw new ConflictException(
            'Состояние заказа изменилось. Оплата недоступна.',
          );
        }

        if (order.paymentType !== PaymentType.CARD) {
          throw new BadRequestException(
            'Для заказа доступна только онлайн-оплата',
          );
        }

        const succeededPayment = await tx.payment.findFirst({
          where: {
            orderId,
            status: PaymentStatus.SUCCEEDED,
          },
          select: {
            id: true,
          },
        });

        if (succeededPayment) {
          throw new ConflictException('Заказ уже оплачен');
        }

        const pendingPayment = await tx.payment.findFirst({
          where: {
            orderId,
            status: PaymentStatus.PENDING,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (pendingPayment) {
          if (pendingPayment.amount !== order.finalAmount) {
            throw new ConflictException(
              'Сумма заказа отличается от суммы уже начатой оплаты',
            );
          }

          // Платёжная запись есть, но внешний
          // запрос ещё не завершил регистрацию.
          //
          // Повторяем ту же операцию с тем же
          // ключом, а не создаём новую попытку.

          if (pendingPayment.providerPaymentId.startsWith(RESERVATION_PREFIX)) {
            const idempotenceKey = readReservationKey(
              pendingPayment.rawResponse,
            );

            if (
              !idempotenceKey ||
              pendingPayment.providerPaymentId !==
                `${RESERVATION_PREFIX}${idempotenceKey}`
            ) {
              throw new ConflictException(
                'Не удалось восстановить платёжную попытку',
              );
            }

            const ageMs = Date.now() - pendingPayment.createdAt.getTime();

            if (ageMs < 0 || ageMs >= IDEMPOTENCE_RETRY_LIMIT_MS) {
              // Ключ мог выйти за безопасное окно
              // идемпотентности ЮKassa.
              //
              // Создавать второй внешний платёж
              // без сверки здесь нельзя.

              throw new ConflictException(
                'Необходимо проверить состояние ранее начатой оплаты',
              );
            }

            return {
              kind: 'RESERVED',
              paymentId: pendingPayment.id,
              placeholderId: pendingPayment.providerPaymentId,
              idempotenceKey,
              amount: pendingPayment.amount,
            };
          }

          const confirmationUrl = readConfirmationUrl(
            pendingPayment.rawResponse,
          );

          if (!confirmationUrl) {
            throw new ConflictException(
              'Платёж уже создан, но ссылка на оплату недоступна',
            );
          }

          return {
            kind: 'EXISTING',
            paymentId: pendingPayment.id,
            providerPaymentId: pendingPayment.providerPaymentId,
            status: pendingPayment.status,
            confirmationUrl,
          };
        }

        const failedAttempts = await tx.payment.count({
          where: {
            orderId,
            status: PaymentStatus.FAILED,
          },
        });

        const idempotenceKey = createPaymentIdempotenceKey(
          orderId,
          order.finalAmount,
          failedAttempts,
        );

        const placeholderId = `${RESERVATION_PREFIX}${idempotenceKey}`;

        // Ключевое изменение:
        // сохраняем попытку ДО вызова ЮKassa.

        const reservation = await tx.payment.create({
          data: {
            orderId,

            providerPaymentId: placeholderId,

            amount: order.finalAmount,

            status: PaymentStatus.PENDING,

            paidAt: null,

            rawResponse: {
              phase: 'CREATING',
              idempotenceKey,
            },
          },
        });

        return {
          kind: 'RESERVED',
          paymentId: reservation.id,
          placeholderId,
          idempotenceKey,
          amount: order.finalAmount,
        };
      },
    );

    // Активный внешний платёж уже существует.
    // Новый запрос к ЮKassa не нужен.

    if (admission.kind === 'EXISTING') {
      return {
        paymentId: admission.paymentId,

        providerPaymentId: admission.providerPaymentId,

        status: admission.status,

        confirmationUrl: admission.confirmationUrl,
      };
    }

    // Транзакция уже завершена.
    //
    // Даже если процесс сейчас упадёт,
    // запись Payment(PENDING) сохранится.

    const yookassaPayment = await this.yookassaService.createPayment({
      orderId,
      amount: admission.amount,
      idempotenceKey: admission.idempotenceKey,
    });

    const paymentStatus = this.mapPaymentStatus(yookassaPayment.status);

    // Два одинаковых запроса с тем же ключом
    // могут получить один ответ ЮKassa.
    //
    // Обновление выполняем по ID резервации
    // и временному providerPaymentId.
    // Поэтому повторная запись не создаёт
    // дополнительный Payment.

    await this.prismaService.payment.updateMany({
      where: {
        id: admission.paymentId,

        providerPaymentId: admission.placeholderId,

        status: PaymentStatus.PENDING,
      },

      data: {
        providerPaymentId: yookassaPayment.id,

        status: paymentStatus,

        paidAt: paymentStatus === PaymentStatus.SUCCEEDED ? new Date() : null,

        rawResponse: yookassaPayment as unknown as Prisma.InputJsonValue,
      },
    });

    const savedPayment = await this.prismaService.payment.findUniqueOrThrow({
      where: {
        id: admission.paymentId,
      },
    });

    return {
      paymentId: savedPayment.id,

      providerPaymentId: savedPayment.providerPaymentId,

      status: savedPayment.status,

      confirmationUrl:
        readConfirmationUrl(savedPayment.rawResponse) ?? undefined,
    };
  }

  public async syncPaymentStatus(userId: string, orderId: string) {
    const payment = await this.prismaService.payment.findFirstOrThrow({
      where: {
        orderId,

        order: {
          userId,
        },
      },

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        order: true,
      },
    });

    // Не отправляем временный ID резервации
    // в GET /payments/{id} ЮKassa.

    if (payment.providerPaymentId.startsWith(RESERVATION_PREFIX)) {
      throw new ConflictException('Создание платежа ещё не завершено');
    }

    const yookassaPayment = await this.yookassaService.getPayment(
      payment.providerPaymentId,
    );

    const paymentStatus = this.mapPaymentStatus(yookassaPayment.status);

    const rawResponse = yookassaPayment as unknown as Prisma.InputJsonValue;

    const orderStatus = await this.prismaService.$transaction(async (tx) => {
      if (paymentStatus === PaymentStatus.SUCCEEDED) {
        await tx.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: PaymentStatus.SUCCEEDED,

            paidAt: payment.paidAt ?? new Date(),

            rawResponse,
          },
        });

        const transition = await tx.order.updateMany({
          where: {
            id: payment.orderId,

            status: OrderStatus.PENDING_PAYMENT,

            paymentType: PaymentType.CARD,
          },

          data: {
            status: OrderStatus.PAID,
          },
        });

        if (transition.count === 1 && payment.order.cartId) {
          await tx.cartItem.deleteMany({
            where: {
              cartId: payment.order.cartId,
            },
          });
        }
      } else {
        await tx.payment.updateMany({
          where: {
            id: payment.id,

            status: PaymentStatus.PENDING,
          },

          data: {
            status: paymentStatus,

            rawResponse,
          },
        });
      }

      const currentOrder = await tx.order.findUniqueOrThrow({
        where: {
          id: payment.orderId,
        },

        select: {
          status: true,
        },
      });

      return currentOrder.status;
    });

    if (
      paymentStatus === PaymentStatus.SUCCEEDED &&
      orderStatus === OrderStatus.CANCELLED
    ) {
      this.logger.warn(
        `Payment succeeded for cancelled order: ${payment.orderId}`,
      );
    }

    return {
      orderId: payment.orderId,

      providerPaymentId: payment.providerPaymentId,

      orderStatus,

      paymentStatus,
    };
  }

  private mapPaymentStatus(
    status: YookassaPaymentResponse['status'],
  ): PaymentStatus {
    if (status === 'succeeded') {
      return PaymentStatus.SUCCEEDED;
    }

    if (status === 'canceled') {
      return PaymentStatus.FAILED;
    }

    return PaymentStatus.PENDING;
  }
}
