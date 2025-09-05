import { PrismaService } from '@/src/core/prisma/prisma.service';
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { ConfigService } from '@nestjs/config';
import { AddProductToCartDto } from './dto/add-product-to-cart.dto';

@Injectable()
export class CartService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly jwt: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async getOrCreateCart({
    token,
    userId,
  }: {
    token?: string;
    userId?: string;
  }) {
    if (userId) {
      let cart = await this.prismaService.cart.findUnique({
        where: { userId },
        include: {
          items: {
            include: {
              product: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!cart) {
        cart = await this.prismaService.cart.create({
          data: {
            user: {
              connect: {
                id: userId,
              },
            },
          },
          include: {
            items: {
              include: {
                product: true,
              },
            },
          },
        });
      }

      return cart;
    }

    let cartToken = token;

    if (!cartToken) {
      cartToken = this.jwt.sign(
        { guest: true, time: Date.now() },
        this.configService.getOrThrow(process.env.JWT_SECRET),
      );
    }

    let cart = await this.prismaService.cart.findUnique({
      where: { cartToken },
      include: {
        items: {
          include: {
            product: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!cart) {
      cart = await this.prismaService.cart.create({
        data: { cartToken },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });
    }

    return cart;
  }

  async addProductToCart(dto: AddProductToCartDto, userId?: string) {
    try {
      const cart = await this.getCart(userId);

      const existingItem = await this.prismaService.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId: dto.productId,
        },
      });

      if (existingItem) {
        return await this.prismaService.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: existingItem.quantity + dto.quantity },
        });
      }

      return await this.prismaService.cartItem.create({
        data: {
          cartId: cart.id,
          productId: dto.productId,
          quantity: dto.quantity,
        },
      });
    } catch (err) {
      console.error('Ошибка при добавлении в корзину:', err);
      throw new InternalServerErrorException(
        'Не удалось добавить товар в корзину',
      );
    }
  }

  async getCart(userId?: string) {
    if (!userId) {
      throw new Error('getCart: both userId and guestId are undefined');
    }

    const cart = await this.prismaService.cart.findFirst({
      where: {
        ...(userId && { userId }),
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    return cart;
  }

  async deleteCartItem(itemId: string) {
    return this.prismaService.cartItem.delete({
      where: {
        id: itemId,
      },
    });
  }

  async updateCartQuantity(cartItemId: string, newQuantity: number) {
    const existingItem = await this.prismaService.cartItem.findFirst({
      where: {
        id: cartItemId,
      },
    });

    if (!existingItem) {
      return new NotFoundException('Данный товар в корзине не был найден!');
    }

    return this.prismaService.cartItem.update({
      where: { id: cartItemId }, // сразу update по уникальному id
      data: { quantity: newQuantity },
    });
  }

  async clearCart(cartId: string) {
    const cart = await this.prismaService.cart.findFirst({
      where: {
        id: cartId,
      },
    });
    if (!cart) {
      throw new InternalServerErrorException('Корзина не найдена');
    }
    await this.prismaService.cartItem.deleteMany({
      where: {
        cartId: cart.id,
      },
    });
  }
}
