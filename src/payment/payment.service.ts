import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
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
  YookassaService,
  type YookassaPaymentResponse,
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

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readConfirmationUrl(
  rawResponse: Prisma.JsonValue | null,
): string | null {
  if (!isJsonObject(rawResponse)) {
    return null;
  }

  const confirmation = rawResponse.confirmation;

  if (!isJsonObject(confirmation)) {
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

  return rawResponse.phase === 'CREATING' &&
    typeof rawResponse.idempotenceKey === 'string'
    ? rawResponse.idempotenceKey
    : null;
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

function paymentSnapshot(
  payment: YookassaPaymentResponse,
): Prisma.InputJsonObject {
  return {
    id: payment.id,
    status: payment.status,
    paid: payment.paid,

    amount: {
      value: payment.amount.value,
      currency: payment.amount.currency,
    },

    created_at: payment.created_at,
    test: payment.test,

    ...(payment.confirmation
      ? {
          confirmation: {
            type: payment.confirmation.type,

            ...(payment.confirmation.confirmation_url
              ? {
                  confirmation_url: payment.confirmation.confirmation_url,
                }
              : {}),

            ...(payment.confirmation.return_url
              ? {
                  return_url: payment.confirmation.return_url,
                }
              : {}),
          },
        }
      : {}),

    ...(payment.metadata
      ? {
          metadata: payment.metadata,
        }
      : {}),

    ...(payment.cancellation_details
      ? {
          cancellation_details: payment.cancellation_details,
        }
      : {}),
  };
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly yookassaService: YookassaService,
  ) {}

  async createPayment(userId: string, orderId: string) {
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
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "order"
          WHERE "id" = ${orderId}
            AND "userId" = ${userId}
          FOR UPDATE
        `;

        if (rows.length !== 1) {
          throw new ConflictException('Заказ недоступен для оплаты');
        }

        const order = await tx.order.findFirstOrThrow({
          where: {
            id: orderId,
            userId,
          },
        });

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

        const succeeded = await tx.payment.findFirst({
          where: {
            orderId,
            status: PaymentStatus.SUCCEEDED,
          },

          select: {
            id: true,
          },
        });

        if (succeeded) {
          throw new ConflictException('Заказ уже оплачен');
        }

        const pending = await tx.payment.findFirst({
          where: {
            orderId,
            status: PaymentStatus.PENDING,
          },

          orderBy: {
            createdAt: 'desc',
          },
        });

        if (pending) {
          if (pending.amount !== order.finalAmount) {
            throw new ConflictException(
              'Сумма заказа отличается от суммы начатой оплаты',
            );
          }

          if (pending.providerPaymentId.startsWith(RESERVATION_PREFIX)) {
            const key = readReservationKey(pending.rawResponse);

            if (
              !key ||
              pending.providerPaymentId !== `${RESERVATION_PREFIX}${key}`
            ) {
              throw new ConflictException(
                'Не удалось восстановить платёжную попытку',
              );
            }

            const age = Date.now() - pending.createdAt.getTime();

            if (age < 0 || age >= IDEMPOTENCE_RETRY_LIMIT_MS) {
              throw new ConflictException(
                'Необходимо проверить ранее начатую оплату',
              );
            }

            return {
              kind: 'RESERVED',
              paymentId: pending.id,
              placeholderId: pending.providerPaymentId,
              idempotenceKey: key,
              amount: pending.amount,
            };
          }

          const confirmationUrl = readConfirmationUrl(pending.rawResponse);

          if (!confirmationUrl) {
            throw new ConflictException(
              'Ссылка на уже созданный платёж недоступна',
            );
          }

          return {
            kind: 'EXISTING',
            paymentId: pending.id,
            providerPaymentId: pending.providerPaymentId,
            status: pending.status,
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
          amount: reservation.amount,
        };
      },
    );

    if (admission.kind === 'EXISTING') {
      return {
        paymentId: admission.paymentId,
        providerPaymentId: admission.providerPaymentId,
        status: admission.status,
        confirmationUrl: admission.confirmationUrl,
      };
    }

    const yookassaPayment = await this.yookassaService.createPayment({
      orderId,
      amount: admission.amount,
      idempotenceKey: admission.idempotenceKey,
    });

    const status = this.mapPaymentStatus(yookassaPayment.status);

    await this.prismaService.payment.updateMany({
      where: {
        id: admission.paymentId,
        providerPaymentId: admission.placeholderId,
        status: PaymentStatus.PENDING,
      },

      data: {
        providerPaymentId: yookassaPayment.id,
        status,
        paidAt: status === PaymentStatus.SUCCEEDED ? new Date() : null,
        rawResponse: paymentSnapshot(yookassaPayment),
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

  async syncPaymentStatus(userId: string, orderId: string) {
    try {
      const payment = await this.prismaService.payment.findFirst({
        where: {
          orderId,

          order: {
            userId,
          },
        },

        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!payment) {
        throw new NotFoundException('Платёж для заказа не найден');
      }

      if (payment.providerPaymentId.startsWith(RESERVATION_PREFIX)) {
        throw new ConflictException('Регистрация платежа ещё не завершена');
      }

      const providerPayment = await this.yookassaService.getPayment(
        payment.providerPaymentId,
      );

      if (
        providerPayment.id !== payment.providerPaymentId ||
        providerPayment.amount.currency !== 'RUB' ||
        Number(providerPayment.amount.value) !== payment.amount
      ) {
        throw new BadGatewayException(
          'Данные платежа в YooKassa не совпадают с заказом',
        );
      }

      const status = this.mapPaymentStatus(providerPayment.status);

      const rawResponse = paymentSnapshot(providerPayment);

      const orderStatus = await this.prismaService.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "order"
            WHERE "id" = ${orderId}
              AND "userId" = ${userId}
            FOR UPDATE
          `;

        if (rows.length !== 1) {
          throw new NotFoundException('Заказ не найден');
        }

        const order = await tx.order.findFirstOrThrow({
          where: {
            id: orderId,
            userId,
          },

          select: {
            id: true,
            status: true,
            paymentType: true,
            cartId: true,
          },
        });

        if (status === PaymentStatus.SUCCEEDED) {
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

          if (
            order.status === OrderStatus.PENDING_PAYMENT &&
            order.paymentType === PaymentType.CARD
          ) {
            await tx.order.update({
              where: {
                id: order.id,
              },

              data: {
                status: OrderStatus.PAID,
              },
            });

            await tx.cartItem.deleteMany({
              where: {
                cartId: order.cartId,
              },
            });

            return OrderStatus.PAID;
          }

          return order.status;
        }

        await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },

          data: {
            status,
            rawResponse,
          },
        });

        return order.status;
      });

      if (
        status === PaymentStatus.SUCCEEDED &&
        orderStatus === OrderStatus.CANCELLED
      ) {
        this.logger.warn(`Payment succeeded for cancelled order: ${orderId}`);
      }

      return {
        orderId,
        providerPaymentId: payment.providerPaymentId,
        orderStatus,
        paymentStatus: status,
      };
    } catch (error) {
      this.logger.error(
        `Ошибка синхронизации оплаты заказа ${orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }

  private mapPaymentStatus(
    status: YookassaPaymentResponse['status'],
  ): PaymentStatus {
    switch (status) {
      case 'succeeded':
        return PaymentStatus.SUCCEEDED;

      case 'canceled':
        return PaymentStatus.FAILED;

      case 'pending':
      case 'waiting_for_capture':
        return PaymentStatus.PENDING;
    }
  }
}
