import {
  Body,
  Controller,
  Get,
  Post,
  Headers,
  BadRequestException,
  Delete,
  Param,
  Put,
  Patch,
} from '@nestjs/common';
import { CartService } from './cart.service';

import { GetOrCreateCartDto } from './dto/get-or-create-cart.dto';
import { JwtService } from '@nestjs/jwt';
import { AddProductToCartDto } from './dto/add-product-to-cart.dto';
import { UpdateQuantityDto } from './dto/update-quantity.dto';

@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly jwt: JwtService,
  ) {}

  @Post('get-or-create')
  async getOrCreateCart(@Body() dto: GetOrCreateCartDto) {
    return await this.cartService.getOrCreateCart(dto);
  }

  @Get()
  async getCart(@Headers('authorization') authHeader?: string) {
    const token = authHeader?.split(' ')[1];
    let userId: string | undefined = undefined;
    let sessionToken: string | undefined = undefined;

    if (token) {
      try {
        const decoded = this.jwt.verify(token, {
          secret: process.env.JWT_SECRET,
        }) as any;
        if (decoded?.userId) {
          userId = decoded.userId;
        } else {
          sessionToken = token;
        }
      } catch {
        sessionToken = token;
      }
    }

    const cart = await this.cartService.getCart(userId);
    return { success: true, cart };
  }

  // @Post('add')
  // async addProductToCart(
  //   @Body() dto: AddProductToCartDto & { guestId?: string },
  //   @Headers('authorization') authHeader?: string,
  // ) {
  //   const token = authHeader?.split(' ')[1];
  //   let userId: string | undefined = undefined;
  //   let guestId: string | undefined = dto.guestId;

  //   // Проверяем токен, если он есть
  //   if (token) {
  //     try {
  //       const decoded = this.jwt.verify(token, {
  //         secret: process.env.JWT_SECRET,
  //       }) as any;

  //       if (decoded?.userId) {
  //         userId = decoded.userId;
  //         guestId = undefined; // авторизация приоритетнее
  //       }
  //     } catch {
  //       // токен недействителен — fallback на guestId
  //     }
  //   }

  //   const currentId = userId || guestId;

  //   const item = await this.cartService.addProductToCart(dto, currentId);
  //   return { success: true, item };
  // }

  @Post('add')
  async addProductToCart(
    @Body() dto: AddProductToCartDto,
    @Headers('authorization') authHeader?: string,
  ) {
    let userId: string | undefined = dto.userId;

    const token = authHeader?.split(' ')[1];
    if (token) {
      try {
        const decoded = this.jwt.verify(token, {
          secret: process.env.JWT_SECRET,
        }) as any;

        if (decoded?.userId) {
          userId = decoded.userId;
        }
      } catch {
        // fallback на dto.userId
      }
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const item = await this.cartService.addProductToCart(dto, userId);
    return { success: true, item };
  }

  @Delete('/:id')
  async deleteCartItem(@Param('id') id: string) {
    return this.cartService.deleteCartItem(id);
  }

  @Delete('clear/:cartId')
  async clearCart(@Param('cartId') cartId: string) {
    return this.cartService.clearCart(cartId);
  }

  @Patch('update-quantity')
  async updateQuantity(@Body() updateQuantityDto: UpdateQuantityDto) {
    return this.cartService.updateCartQuantity(
      updateQuantityDto.cartItemId,
      updateQuantityDto.quantity,
    );
  }
}
