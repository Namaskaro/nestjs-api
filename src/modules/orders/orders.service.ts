import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, PaymentType, Prisma } from '@/prisma/generated';
import { CheckoutOrderDto } from './dto/checkout-order-dto';

@Injectable()
export class OrdersService {
  public constructor(private readonly prismaService: PrismaService) {}

  public async getAllOrders() {
    const orders = await this.prismaService.order.findMany({
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    if (!orders) {
      throw new NotFoundException({
        message: 'Заказы не были найдены. Попробуйте позже.',
      });
    }
    return orders;
  }

  public async getUserOrders(userId: string) {
    const userOrders = await this.prismaService.order.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    if (!userOrders) {
      throw new NotFoundException({
        message: 'Заказы для данного пользователя не были найдены',
      });
    }
    return userOrders;
  }

  public async getOrderById(orderId: string) {
    const order = await this.prismaService.order.findUnique({
      where: {
        id: orderId,
      },
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Заказ не был найден',
      });
    }
    return order;
  }

  public async createOrder(data: CreateOrderDto) {
    const { userId, ...rest } = data;

    const currentCart = await this.prismaService.cart.findFirst({
      where: {
        id: data.cartId,
      },
    });

    const items = await this.prismaService.cartItem.findMany({
      where: { cartId: data.cartId },
      include: { product: true },
    });

    const orderItems = items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      size: item.size,
      price: item.product.price,
    }));

    try {
      return this.prismaService.order.create({
        data: {
          ...rest,
          items: orderItems as Prisma.InputJsonValue,
          status: OrderStatus.DRAFT,
          paymentType: PaymentType.CARD,
          finalAmount: currentCart.totalAmount,
          totalAmount: currentCart.totalAmount,
          user: {
            connect: { id: userId },
          },
        },
      });
    } catch (error) {
      throw new Error('Не удалось создать заказ. Попробуйте снова!');
    }
  }

  // public async checkoutOrder(userId: string, data: CheckoutOrderDto) {}

  private async checkPromocode(promo: string) {
    const promocode = await this.prismaService.promoCode.findUnique({
      where: {
        code: promo,
      },
    });
    if (!promocode) {
      throw new NotFoundException({
        message: 'Такого промокода не существует',
      });
    }
    return promocode;
  }
}
