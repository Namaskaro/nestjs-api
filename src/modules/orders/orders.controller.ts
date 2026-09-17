import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CheckoutOrderDto } from './dto/checkout-order-dto';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../user/decorators/user.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Auth()
  public create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(userId, dto);
  }

  @Patch(':orderId/checkout')
  @Auth()
  public checkout(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
    @Body() dto: CheckoutOrderDto,
  ) {
    return this.ordersService.checkoutOrder(userId, orderId, dto);
  }

  // NEW
  @Post('promocode/validate')
  @Auth()
  public checkPromocode(@Body('code') code: string) {
    return this.ordersService.checkPromocode(code);
  }

  @Get('my')
  @Auth()
  public getMyOrders(@CurrentUser('id') userId: string) {
    return this.ordersService.getUserOrders(userId);
  }

  @Get(':orderId')
  @Auth()
  public getOrder(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getOrderById(userId, orderId);
  }
}
