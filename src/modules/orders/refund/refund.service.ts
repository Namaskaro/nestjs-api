import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { randomUUID } from 'node:crypto';

import {
  OrderStatus,
  PaymentStatus,
  PaymentType,
  RefundStatus,
  ShipmentStatus,
  SupportCaseStatus,
} from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import {
  YookassaService,
  type YookassaRefundResponse,
} from '@/src/payment/yookassa/yookassa.service';

import { lockCurrentStoreOrder } from '../adapters/current-store-order-lock';

const IDEMPOTENCE_RETRY_LIMIT_MS = 23 * 60 * 60 * 1000;

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yookassa: YookassaService,
  ) {}

  async cancelAndRefund(
    userId: string,
    orderId: string,
    caseId: string,
  ): Promise<RefundStatus> {
    const reservation = await this.prisma.$transaction(async (tx) => {
      if (!(await lockCurrentStoreOrder(tx, orderId))) {
        throw new NotFoundException('Заказ не найден');
      }

      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        include: { payments: true, shipments: true, refund: true },
      });

      if (!order) {
        throw new NotFoundException('Заказ не найден');
      }

      if (order.refund) {
        const payment = order.payments.find(
          (item) => item.id === order.refund?.paymentId,
        );

        if (order.status !== OrderStatus.CANCELLED || !payment) {
          throw new ConflictException('Несогласованное состояние возврата');
        }

        return {
          refund: order.refund,
          providerPaymentId: payment.providerPaymentId,
        };
      }

      if (
        (order.status !== OrderStatus.PAID &&
          order.status !== OrderStatus.PROCESSING) ||
        order.paymentType !== PaymentType.CARD
      ) {
        throw new ConflictException('Автоматическая отмена недоступна');
      }

      if (
        order.shipments.some(
          (shipment) =>
            shipment.status !== ShipmentStatus.PENDING ||
            shipment.shippedAt !== null,
        )
      ) {
        throw new ConflictException('Заказ уже передан в доставку');
      }

      if (
        order.payments.some(
          (payment) => payment.status === PaymentStatus.PENDING,
        )
      ) {
        throw new ConflictException('Оплата ещё обрабатывается');
      }

      const payments = order.payments.filter(
        (payment) => payment.status === PaymentStatus.SUCCEEDED,
      );

      if (
        payments.length !== 1 ||
        payments[0].amount !== order.finalAmount ||
        payments[0].amount <= 0 ||
        payments[0].providerPaymentId.startsWith('reservation:')
      ) {
        throw new ConflictException('Не подтверждена полная оплата');
      }

      const refund = await tx.refund.create({
        data: {
          orderId,
          paymentId: payments[0].id,
          amount: payments[0].amount,
          idempotenceKey: randomUUID(),
          status: RefundStatus.PENDING,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      return {
        refund,
        providerPaymentId: payments[0].providerPaymentId,
      };
    });

    const { refund, providerPaymentId } = reservation;

    if (refund.status === RefundStatus.SUCCEEDED) {
      await this.resolveCase(userId, caseId);
      return RefundStatus.SUCCEEDED;
    }

    if (refund.status === RefundStatus.CANCELED) {
      return RefundStatus.CANCELED;
    }

    try {
      if (refund.providerRefundId) {
        const response = await this.yookassa.getRefund(refund.providerRefundId);

        return await this.saveResult(
          refund.id,
          providerPaymentId,
          refund.amount,
          userId,
          caseId,
          response,
        );
      }

      const age = Date.now() - refund.createdAt.getTime();

      if (age < 0 || age >= IDEMPOTENCE_RETRY_LIMIT_MS) {
        this.logger.warn(`Возврат ${refund.id} требует ручной сверки`);

        return RefundStatus.PENDING;
      }

      const response = await this.yookassa.createFullRefund({
        providerPaymentId,
        amount: refund.amount,
        idempotenceKey: refund.idempotenceKey,
      });

      return await this.saveResult(
        refund.id,
        providerPaymentId,
        refund.amount,
        userId,
        caseId,
        response,
      );
    } catch (error) {
      this.logger.error(
        `Не удалось завершить возврат ${refund.id}`,
        error instanceof Error ? error.stack : undefined,
      );

      return RefundStatus.PENDING;
    }
  }

  private async saveResult(
    refundId: string,
    expectedPaymentId: string,
    expectedAmount: number,
    userId: string,
    caseId: string,
    response: YookassaRefundResponse,
  ): Promise<RefundStatus> {
    if (
      !response.id ||
      response.payment_id !== expectedPaymentId ||
      response.amount.currency !== 'RUB' ||
      Number(response.amount.value) !== expectedAmount
    ) {
      throw new ConflictException('Ответ YooKassa не соответствует платежу');
    }

    const status = this.mapStatus(response.status);

    await this.prisma.refund.updateMany({
      where: {
        id: refundId,
        status: RefundStatus.PENDING,
      },

      data: {
        providerRefundId: response.id,
        status,

        rawResponse: {
          id: response.id,
          paymentId: response.payment_id,
          status: response.status,
          amount: response.amount.value,
          currency: response.amount.currency,
          createdAt: response.created_at,
        },
      },
    });

    if (status === RefundStatus.SUCCEEDED) {
      await this.resolveCase(userId, caseId);
    }

    return status;
  }

  private async resolveCase(userId: string, caseId: string): Promise<void> {
    await this.prisma.supportCase.updateMany({
      where: {
        id: caseId,
        userId,
        status: SupportCaseStatus.WAITING_OPERATOR,
      },

      data: {
        status: SupportCaseStatus.RESOLVED,
        closedAt: new Date(),
      },
    });
  }

  private mapStatus(status: YookassaRefundResponse['status']): RefundStatus {
    switch (status) {
      case 'pending':
        return RefundStatus.PENDING;

      case 'succeeded':
        return RefundStatus.SUCCEEDED;

      case 'canceled':
        return RefundStatus.CANCELED;
    }
  }
}
