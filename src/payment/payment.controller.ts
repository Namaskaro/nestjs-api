import { Controller, Get, Param, Post } from '@nestjs/common';

import { Auth } from '../modules/auth/decorators/auth.decorator';

import { CurrentUser } from '../modules/user/decorators/user.decorator';

import { PaymentService } from './payment.service';

@Controller('payment')
export class PaymentController {
  public constructor(private readonly paymentService: PaymentService) {}

  @Post('orders/:orderId')
  @Auth()
  public createPayment(
    @CurrentUser('id')
    userId: string,

    @Param('orderId')
    orderId: string,
  ) {
    return this.paymentService.createPayment(userId, orderId);
  }

  // NEW
  @Get('orders/:orderId/status')
  @Auth()
  public syncPaymentStatus(
    @CurrentUser('id')
    userId: string,

    @Param('orderId')
    orderId: string,
  ) {
    return this.paymentService.syncPaymentStatus(userId, orderId);
  }
}
