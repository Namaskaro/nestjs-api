import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DiscountType,
  OrderStatus as PrismaOrderStatus,
  PaymentStatus,
  PaymentType,
  ShipmentStatus as PrismaShipmentStatus,
  type Prisma,
} from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { CreateOrderDto } from './dto/create-order.dto';
import { CheckoutOrderDto } from './dto/checkout-order-dto';

import {
  CreateOrderShipmentDto,
  UpdateOrderShipmentDto,
} from './dto/order-shipment.dto';

import { DELIVERY_PRICES, PROMOCODES } from './constants/order.constants';

import { lockCurrentStoreOrder } from './adapters/current-store-order-lock';

import {
  getOrderCancellationEligibility as evaluateOrderCancellation,
  selectRelevantOrder,
} from './core/order-policy';

import { canTransitionShipmentStatus } from './core/shipment-policy';

import {
  ShipmentRecordSchema,
  type OrderRecord,
  type ShipmentRecord,
} from './core/order-record.schema';

import { ORDER_PORT, type OrderPort } from './ports/order.port';

const FULFILLABLE_ORDER_STATUSES: PrismaOrderStatus[] = [
  PrismaOrderStatus.PAID,
  PrismaOrderStatus.PROCESSING,
  PrismaOrderStatus.SHIPPED,
];

const STARTED_SHIPMENT_STATUSES: PrismaShipmentStatus[] = [
  PrismaShipmentStatus.SHIPPED,
  PrismaShipmentStatus.IN_TRANSIT,
  PrismaShipmentStatus.OUT_FOR_DELIVERY,
  PrismaShipmentStatus.DELIVERED,
  PrismaShipmentStatus.EXCEPTION,
  PrismaShipmentStatus.RETURNED,
];

function dateOrNull(value: string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_PORT)
    private readonly orderPort: OrderPort,
    private readonly prismaService: PrismaService,
  ) {}

  async getAllOrders() {
    return this.prismaService.order.findMany({
      include: {
        user: true,
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getUserOrders(userId: string): Promise<OrderRecord[]> {
    return this.orderPort.getUserOrders(userId);
  }

  async getOrderById(userId: string, orderId: string): Promise<OrderRecord> {
    return this.orderPort.getOrderById(userId, orderId);
  }

  async getOrderByNumber(
    userId: string,
    orderNumber: string,
  ): Promise<OrderRecord | null> {
    return this.orderPort.getOrderByNumber(userId, orderNumber);
  }

  async getLatestUserOrder(userId: string): Promise<OrderRecord | null> {
    return this.orderPort.getLatestUserOrder(userId);
  }

  async getRelevantUserOrder(userId: string): Promise<OrderRecord | null> {
    const orders = await this.orderPort.getUserOrders(userId);

    return selectRelevantOrder(orders);
  }

  async getOrderCancellationEligibility(userId: string, orderId: string) {
    const order = await this.orderPort.getOrderById(userId, orderId);

    return {
      order,
      eligibility: evaluateOrderCancellation(order),
    };
  }

  async cancelOrder(userId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.orderPort.getOrderById(userId, orderId);

    const eligibility = evaluateOrderCancellation(order);

    if (!eligibility.allowed) {
      throw new BadRequestException({
        message: 'Этот заказ нельзя отменить',
        reason: eligibility.reason,
      });
    }

    const cancelledOrder = await this.orderPort.cancelOrder(userId, orderId);

    if (!cancelledOrder) {
      throw new ConflictException({
        message: 'Состояние заказа изменилось. Отмена больше невозможна.',
      });
    }

    return cancelledOrder;
  }

  async createOrderShipment(
    orderId: string,
    data: CreateOrderShipmentDto,
  ): Promise<ShipmentRecord> {
    return this.prismaService.$transaction(async (tx) => {
      const orderExists = await lockCurrentStoreOrder(tx, orderId);

      if (!orderExists) {
        throw new NotFoundException('Заказ не найден');
      }

      const order = await tx.order.findUnique({
        where: {
          id: orderId,
        },

        select: {
          status: true,
          paymentType: true,
          finalAmount: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Заказ не найден');
      }

      if (!FULFILLABLE_ORDER_STATUSES.includes(order.status)) {
        throw new BadRequestException(
          'Для заказа в текущем статусе нельзя создать отправление',
        );
      }

      await this.assertConfirmedPrepayment(
        tx,
        orderId,
        order.paymentType,
        order.finalAmount,
      );

      const shipment = await tx.shipment.create({
        data: {
          orderId,

          provider: data.provider.trim(),

          status: data.status ?? PrismaShipmentStatus.PENDING,

          trackingNumber: data.trackingNumber?.trim() || null,

          trackingUrl: data.trackingUrl || null,

          estimatedDeliveryAt: dateOrNull(data.estimatedDeliveryAt),

          shippedAt: dateOrNull(data.shippedAt),

          deliveredAt: dateOrNull(data.deliveredAt),
        },
      });

      await this.synchronizeShipmentOrderStatus(tx, orderId);

      return ShipmentRecordSchema.parse(shipment);
    });
  }

  async updateOrderShipment(
    orderId: string,
    shipmentId: string,
    data: UpdateOrderShipmentDto,
  ): Promise<ShipmentRecord> {
    return this.prismaService.$transaction(async (tx) => {
      const orderExists = await lockCurrentStoreOrder(tx, orderId);

      if (!orderExists) {
        throw new NotFoundException('Заказ не найден');
      }

      const order = await tx.order.findUnique({
        where: {
          id: orderId,
        },

        select: {
          status: true,
          paymentType: true,
          finalAmount: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Заказ не найден');
      }

      if (order.status === PrismaOrderStatus.CANCELLED) {
        throw new BadRequestException(
          'Отправления отменённого заказа нельзя изменять',
        );
      }

      const existingShipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          orderId,
        },

        select: {
          id: true,
          status: true,
        },
      });

      if (!existingShipment) {
        throw new NotFoundException('Отправление не найдено');
      }

      if (
        data.status !== undefined &&
        !canTransitionShipmentStatus(existingShipment.status, data.status)
      ) {
        throw new ConflictException({
          message: 'Недопустимый переход статуса отправления',
          currentStatus: existingShipment.status,
          requestedStatus: data.status,
        });
      }

      await this.assertConfirmedPrepayment(
        tx,
        orderId,
        order.paymentType,
        order.finalAmount,
      );

      const updateData: Prisma.ShipmentUpdateInput = {
        ...(data.provider !== undefined
          ? {
              provider: data.provider?.trim() ?? null,
            }
          : {}),

        ...(data.status !== undefined
          ? {
              status: data.status,
            }
          : {}),

        ...(data.trackingNumber !== undefined
          ? {
              trackingNumber: data.trackingNumber?.trim() || null,
            }
          : {}),

        ...(data.trackingUrl !== undefined
          ? {
              trackingUrl: data.trackingUrl || null,
            }
          : {}),

        ...(data.estimatedDeliveryAt !== undefined
          ? {
              estimatedDeliveryAt: dateOrNull(data.estimatedDeliveryAt),
            }
          : {}),

        ...(data.shippedAt !== undefined
          ? {
              shippedAt: dateOrNull(data.shippedAt),
            }
          : {}),

        ...(data.deliveredAt !== undefined
          ? {
              deliveredAt: dateOrNull(data.deliveredAt),
            }
          : {}),
      };

      const shipment = await tx.shipment.update({
        where: {
          id: existingShipment.id,
        },

        data: updateData,
      });

      await this.synchronizeShipmentOrderStatus(tx, orderId);

      return ShipmentRecordSchema.parse(shipment);
    });
  }

  private async assertConfirmedPrepayment(
    tx: Prisma.TransactionClient,
    orderId: string,
    paymentType: PaymentType,
    finalAmount: number,
  ): Promise<void> {
    if (paymentType !== PaymentType.CARD) {
      throw new BadRequestException(
        'Отправка возможна только для заказа с онлайн-оплатой',
      );
    }

    const succeededPayment = await tx.payment.findFirst({
      where: {
        orderId,
        status: PaymentStatus.SUCCEEDED,
        amount: finalAmount,
      },

      select: {
        id: true,
      },
    });

    if (!succeededPayment) {
      throw new BadRequestException(
        'Нельзя оформить отправление без подтверждённой полной оплаты заказа',
      );
    }
  }

  private async synchronizeShipmentOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const shipments = await tx.shipment.findMany({
      where: {
        orderId,
      },

      select: {
        status: true,
      },
    });

    if (!shipments.length) {
      return;
    }

    const allDelivered = shipments.every(
      (shipment) => shipment.status === PrismaShipmentStatus.DELIVERED,
    );

    if (allDelivered) {
      await tx.order.updateMany({
        where: {
          id: orderId,

          status: {
            in: FULFILLABLE_ORDER_STATUSES,
          },
        },

        data: {
          status: PrismaOrderStatus.DELIVERED,
        },
      });

      return;
    }

    const anyStarted = shipments.some((shipment) =>
      STARTED_SHIPMENT_STATUSES.includes(shipment.status),
    );

    if (anyStarted) {
      await tx.order.updateMany({
        where: {
          id: orderId,

          status: {
            in: [PrismaOrderStatus.PAID, PrismaOrderStatus.PROCESSING],
          },
        },

        data: {
          status: PrismaOrderStatus.SHIPPED,
        },
      });
    }
  }

  async createOrder(userId: string, data: CreateOrderDto) {
    return this.prismaService.$transaction(async (tx) => {
      const lockedCart = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "cart"
        WHERE "id" = ${data.cartId}
          AND "userId" = ${userId}
        FOR UPDATE
      `;

      if (lockedCart.length !== 1) {
        throw new NotFoundException('Корзина не найдена');
      }

      const currentCart = await tx.cart.findFirstOrThrow({
        where: {
          id: data.cartId,
          userId,
        },

        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (currentCart.items.length === 0) {
        throw new BadRequestException('Корзина пуста');
      }

      const totalAmount = currentCart.items.reduce(
        (total, item) => total + Number(item.product.price) * item.quantity,
        0,
      );

      if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
        throw new BadRequestException('Некорректная сумма товаров в корзине');
      }

      const orderItems = currentCart.items.map((item) => ({
        productId: item.productId,
        title: item.product.title,
        image: item.product.images[0] ?? null,
        quantity: item.quantity,
        size: item.size,
        price: item.product.price,
      }));

      const lastPaidOrder = await tx.order.findFirst({
        where: {
          userId,
          cartId: currentCart.id,

          payments: {
            some: {
              status: PaymentStatus.SUCCEEDED,
            },
          },
        },

        orderBy: {
          createdAt: 'desc',
        },

        select: {
          createdAt: true,
        },
      });

      const existingOrder = await tx.order.findFirst({
        where: {
          userId,
          cartId: currentCart.id,

          status: {
            in: [PrismaOrderStatus.DRAFT, PrismaOrderStatus.PENDING_PAYMENT],
          },

          ...(lastPaidOrder
            ? {
                createdAt: {
                  gt: lastPaidOrder.createdAt,
                },
              }
            : {}),
        },

        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],

        include: {
          payments: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

      if (existingOrder) {
        if (existingOrder.status === PrismaOrderStatus.PENDING_PAYMENT) {
          return existingOrder;
        }

        return tx.order.update({
          where: {
            id: existingOrder.id,
          },

          data: {
            items: orderItems,
            totalAmount,
            finalAmount: totalAmount,
          },

          include: {
            payments: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        });
      }

      return tx.order.create({
        data: {
          cartId: currentCart.id,

          items: orderItems,

          status: PrismaOrderStatus.DRAFT,

          paymentType: PaymentType.CARD,

          totalAmount,

          finalAmount: totalAmount,

          user: {
            connect: {
              id: userId,
            },
          },
        },

        include: {
          payments: true,
        },
      });
    });
  }

  async checkoutOrder(userId: string, orderId: string, data: CheckoutOrderDto) {
    const order = await this.prismaService.order.findFirstOrThrow({
      where: {
        id: orderId,
        userId,
      },
    });

    if (
      order.status !== PrismaOrderStatus.DRAFT &&
      order.status !== PrismaOrderStatus.PENDING_PAYMENT
    ) {
      throw new BadRequestException('Данные заказа уже нельзя изменить');
    }

    if (data.paymentType !== PaymentType.CARD) {
      throw new BadRequestException('Доступна только онлайн-оплата картой');
    }

    const activePayment = await this.prismaService.payment.findFirst({
      where: {
        orderId: order.id,

        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.SUCCEEDED],
        },
      },

      select: {
        id: true,
      },
    });

    if (activePayment) {
      throw new ConflictException(
        'Для заказа уже начата оплата. Изменять данные оформления сейчас нельзя.',
      );
    }

    const deliveryFee = data.deliveryProvider
      ? DELIVERY_PRICES[data.deliveryProvider] ?? 0
      : 0;

    let discountAmount = 0;

    if (data.promoCode) {
      const normalizedPromoCode = data.promoCode.trim().toUpperCase();

      const promo = PROMOCODES.find(
        (item) => item.code === normalizedPromoCode,
      );

      if (!promo) {
        throw new BadRequestException('Промокод не действителен');
      }

      discountAmount =
        promo.discountType === DiscountType.PERCENT
          ? Math.floor((order.totalAmount / 100) * promo.discountValue)
          : promo.discountValue;
    }

    const finalAmount = Math.max(
      0,
      order.totalAmount - discountAmount + deliveryFee,
    );

    return this.prismaService.order.update({
      where: {
        id: order.id,
      },

      data: {
        fullName: data.fullName,
        address: data.address,
        email: data.email,
        phone: data.phone,
        comment: data.comment,
        deliveryDate: new Date(data.deliveryDate),
        deliveryFee,
        deliveryTime: data.deliveryTime,
        paymentType: PaymentType.CARD,
        deliveryProvider: data.deliveryProvider,
        finalAmount,
        status: PrismaOrderStatus.PENDING_PAYMENT,
      },

      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  checkPromocode(code: string) {
    const normalizedPromoCode = code.trim().toUpperCase();

    const promo = PROMOCODES.find((item) => item.code === normalizedPromoCode);

    if (!promo) {
      throw new BadRequestException('Промокод недействителен');
    }

    return promo;
  }
}
