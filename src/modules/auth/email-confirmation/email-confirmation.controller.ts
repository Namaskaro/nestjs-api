// import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
// import { EmailConfirmationService } from './email-confirmation.service';
// import { Request } from 'express';
// import { ConfirmationDto } from './dto/confirmation.dto';
// import { ResendVerificationDto } from './dto/resend-verification.dto';

// @Controller('auth/email-confirmation')
// export class EmailConfirmationController {
//   constructor(
//     private readonly emailConfirmationService: EmailConfirmationService,
//   ) {}

//   @Post()
//   @HttpCode(200)
//   public async newVerification(
//     @Req() req: Request,
//     @Body() dto: ConfirmationDto,
//   ) {
//     return this.emailConfirmationService.newVerification(req, dto);
//   }

//   @Post('resend-verification')
//   async resendVerification(@Body() dto: ResendVerificationDto) {
//     return this.emailConfirmationService.resendVerification(dto.email);
//   }
// }

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { EmailConfirmationService } from './email-confirmation.service';
import { ConfirmationDto } from './dto/confirmation.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

@Controller('auth/email-confirmation')
export class EmailConfirmationController {
  constructor(
    private readonly emailConfirmationService: EmailConfirmationService,
  ) {}

  @Post()
  @HttpCode(200)
  public async newVerification(@Body() dto: ConfirmationDto) {
    return this.emailConfirmationService.newVerification(dto);
  }

  @Post('resend-verification')
  @HttpCode(200)
  public async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.emailConfirmationService.resendVerification(dto.email);
  }
}
