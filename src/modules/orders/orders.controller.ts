import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';

import { CreateOrderDto } from './dto/create-order.dto';

import { CheckoutOrderDto } from './dto/checkout-order-dto';

import {
  CreateOrderShipmentDto,
  UpdateOrderShipmentDto,
} from './dto/order-shipment.dto';

import { Auth } from '../auth/decorators/auth.decorator';

import { Admin } from '../auth/decorators/admin.decorator';

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

  @Get(':orderId/shipments')
  @Auth()
  public async getOrderShipments(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
  ) {
    const order = await this.ordersService.getOrderById(userId, orderId);

    return order.shipments ?? [];
  }

  @Post(':orderId/shipments')
  @Admin()
  public createShipment(
    @Param('orderId') orderId: string,
    @Body() dto: CreateOrderShipmentDto,
  ) {
    return this.ordersService.createOrderShipment(orderId, dto);
  }

  @Patch(':orderId/shipments/:shipmentId')
  @Admin()
  public updateShipment(
    @Param('orderId') orderId: string,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: UpdateOrderShipmentDto,
  ) {
    return this.ordersService.updateOrderShipment(orderId, shipmentId, dto);
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
