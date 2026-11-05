import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CurrentUser } from '../user/decorators/user.decorator';

import { ChatService } from './chat.service';

import { InviteOperatorDto } from './dto/invite-operator.dto';

import { ActivateOperatorDto } from './dto/activate-operator.dto';

@Controller('operators')
export class OperatorInvitationController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /operators/invitations
   *
   * Создать приглашение оператора.
   *
   * Доступ:
   * только авторизованный Admin.
   */
  @Post('invitations')
  @UseGuards(JwtAuthGuard)
  async inviteOperator(
    @CurrentUser('id')
    adminUserId: string,

    @Body()
    dto: InviteOperatorDto,
  ) {
    const invitation = await this.chatService.inviteOperator(
      dto.email,
      adminUserId,
    );

    /*
     * Токен не возвращаем в HTTP-ответе.
     *
     * Он отправляется сотруднику по email.
     */
    return {
      userId: invitation.userId,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * POST /operators/invitations/activate
   *
   * Завершить регистрацию приглашённого
   * сотрудника.
   *
   * Авторизация не требуется:
   * право подтверждается токеном приглашения.
   */
  @Post('invitations/activate')
  @HttpCode(HttpStatus.OK)
  async activateOperator(
    @Body()
    dto: ActivateOperatorDto,
  ) {
    return this.chatService.activateOperator(
      dto.token,
      dto.password,
      dto.name.trim(),
    );
  }
}
