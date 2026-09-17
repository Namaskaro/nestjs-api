import { PrismaService } from '@/src/core/prisma/prisma.service';

import { BadRequestException, Injectable } from '@nestjs/common';

import { DiscountType, OrderStatus, PaymentType } from '@/prisma/generated';

import { CreateOrderDto } from './dto/create-order.dto';
import { CheckoutOrderDto } from './dto/checkout-order-dto';
import { DELIVERY_PRICES, PROMOCODES } from './constants/order.constants';

@Injectable()
export class OrdersService {
  public constructor(private readonly prismaService: PrismaService) {}

  public async getAllOrders() {
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

  public async getUserOrders(userId: string) {
    return this.prismaService.order.findMany({
      where: {
        userId,
      },

      include: {
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

  public async getOrderById(userId: string, orderId: string) {
    return this.prismaService.order.findFirstOrThrow({
      where: {
        id: orderId,
        userId,
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

  public async createOrder(userId: string, data: CreateOrderDto) {
    const currentCart = await this.prismaService.cart.findFirstOrThrow({
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

    const totalAmount = currentCart.items.reduce((total, item) => {
      return total + Number(item.product.price) * item.quantity;
    }, 0);

    const orderItems = currentCart.items.map((item) => ({
      productId: item.productId,
      title: item.product.title,
      image: item.product.images[0] ?? null,
      quantity: item.quantity,
      size: item.size,
      price: item.product.price,
    }));

    return this.prismaService.order.create({
      data: {
        cartId: currentCart.id,

        items: orderItems,

        status: OrderStatus.DRAFT,

        paymentType: PaymentType.CARD,

        totalAmount,
        finalAmount: totalAmount,

        user: {
          connect: {
            id: userId,
          },
        },
      },
    });
  }

  public async checkoutOrder(
    userId: string,
    orderId: string,
    data: CheckoutOrderDto,
  ) {
    const order = await this.prismaService.order.findFirstOrThrow({
      where: {
        id: orderId,
        userId,
      },
    });

    if (
      order.status !== OrderStatus.DRAFT &&
      order.status !== OrderStatus.PENDING_PAYMENT
    ) {
      throw new BadRequestException({
        message: 'Данные заказа уже нельзя изменить',
      });
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
        throw new BadRequestException({ message: 'Промокод не действителен' });
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

    const status =
      data.paymentType === PaymentType.CARD
        ? OrderStatus.PENDING_PAYMENT
        : OrderStatus.PROCESSING;

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

        paymentType: data.paymentType,
        deliveryProvider: data.deliveryProvider,

        finalAmount,

        status,
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

  public checkPromocode(code: string) {
    const normalizedCode = code.trim().toUpperCase();

    const promo = PROMOCODES.find((item) => item.code === normalizedCode);

    if (!promo) {
      throw new BadRequestException('Промокод недействителен');
    }

    return promo;
  }
}
