import { BadRequestException, Injectable } from '@nestjs/common';

import { OrderStatus, PaymentStatus, Prisma } from '@/prisma/generated';

import { PrismaService } from '../core/prisma/prisma.service';
import {
  YookassaPaymentResponse,
  YookassaService,
} from './yookassa/yookassa.service';

@Injectable()
export class PaymentService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly yookassaService: YookassaService,
  ) {}

  public async createPayment(userId: string, orderId: string) {
    const order = await this.prismaService.order.findFirstOrThrow({
      where: {
        id: orderId,
        userId,
      },
    });

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Заказ не готов к оплате');
    }

    const yookassaPayment = await this.yookassaService.createPayment({
      orderId: order.id,
      amount: order.finalAmount,
    });

    const paymentStatus = this.mapPaymentStatus(yookassaPayment.status);

    const payment = await this.prismaService.payment.create({
      data: {
        orderId: order.id,

        providerPaymentId: yookassaPayment.id,

        amount: order.finalAmount,

        status: paymentStatus,

        paidAt: paymentStatus === PaymentStatus.SUCCEEDED ? new Date() : null,

        rawResponse: yookassaPayment as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      paymentId: payment.id,

      providerPaymentId: payment.providerPaymentId,

      status: payment.status,

      confirmationUrl: yookassaPayment.confirmation?.confirmation_url,
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

    const yookassaPayment = await this.yookassaService.getPayment(
      payment.providerPaymentId,
    );

    const paymentStatus = this.mapPaymentStatus(yookassaPayment.status);

    /*
     * УСПЕШНАЯ ОПЛАТА
     *
     * 1. Payment -> SUCCEEDED
     * 2. Order -> PAID
     * 3. Удаляем все товары из корзины
     */
    if (paymentStatus === PaymentStatus.SUCCEEDED) {
      await this.prismaService.$transaction([
        this.prismaService.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: PaymentStatus.SUCCEEDED,

            paidAt: payment.paidAt ?? new Date(),

            rawResponse: yookassaPayment as unknown as Prisma.InputJsonValue,
          },
        }),

        this.prismaService.order.update({
          where: {
            id: payment.orderId,
          },

          data: {
            status: OrderStatus.PAID,
          },
        }),

        /*
         * NEW:
         * сам Cart не удаляем.
         *
         * Удаляем только CartItem.
         *
         * После этого у пользователя
         * остаётся пустая корзина.
         */
        this.prismaService.cartItem.deleteMany({
          where: {
            cartId: payment.order.cartId,
          },
        }),
      ]);

      return {
        orderId: payment.orderId,

        providerPaymentId: payment.providerPaymentId,

        orderStatus: OrderStatus.PAID,

        paymentStatus: PaymentStatus.SUCCEEDED,
      };
    }

    /*
     * НЕУСПЕШНАЯ ОПЛАТА
     *
     * Payment -> FAILED
     * Order остаётся PENDING_PAYMENT
     *
     * Корзину НЕ очищаем,
     * потому что пользователь
     * должен иметь возможность
     * попробовать оплатить ещё раз.
     */
    if (paymentStatus === PaymentStatus.FAILED) {
      await this.prismaService.$transaction([
        this.prismaService.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: PaymentStatus.FAILED,

            rawResponse: yookassaPayment as unknown as Prisma.InputJsonValue,
          },
        }),

        this.prismaService.order.update({
          where: {
            id: payment.orderId,
          },

          data: {
            status: OrderStatus.PENDING_PAYMENT,
          },
        }),
      ]);

      return {
        orderId: payment.orderId,

        providerPaymentId: payment.providerPaymentId,

        orderStatus: OrderStatus.PENDING_PAYMENT,

        paymentStatus: PaymentStatus.FAILED,
      };
    }

    /*
     * Платёж всё ещё обрабатывается.
     */
    await this.prismaService.payment.update({
      where: {
        id: payment.id,
      },

      data: {
        status: PaymentStatus.PENDING,

        rawResponse: yookassaPayment as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      orderId: payment.orderId,

      providerPaymentId: payment.providerPaymentId,

      orderStatus: payment.order.status,

      paymentStatus: PaymentStatus.PENDING,
    };
  }

  private mapPaymentStatus(status: YookassaPaymentResponse['status']) {
    if (status === 'succeeded') {
      return PaymentStatus.SUCCEEDED;
    }

    if (status === 'canceled') {
      return PaymentStatus.FAILED;
    }

    return PaymentStatus.PENDING;
  }
}
