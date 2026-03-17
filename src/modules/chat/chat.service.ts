import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { UserService } from '../user/user.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { WsUser } from './entities/ws-user.entity';
import { v4 as uuidv4 } from 'uuid';
import { TokenType } from '@/prisma/generated';
import { MailService } from '@/src/mail/mail.service';
import { hash } from 'argon2';

@Injectable()
export class ChatService {
  constructor(
    private readonly userService: UserService,
    private readonly prismaService: PrismaService,
    private readonly emailService: MailService,
  ) {}
  async assertUserCanAccessChat(user: WsUser, chatId: string) {
    const chat = await this.prismaService.chat.findUnique({
      where: { id: chatId },
      select: {
        userId: true,
        operator: { select: { userId: true } },
      },
    });

    if (!chat) {
      throw new ForbiddenException('Чат не найден');
    }

    if (chat.userId !== user.id && chat.operator?.userId !== user.id) {
      throw new ForbiddenException('У вас нет доступа к этому чату!');
    }
  }

  async createMessage(params: {
    chatId: string;
    content: string;
    user: WsUser;
  }) {
    const senderType = params.user.role === 'Manager' ? 'OPERATOR' : 'USER';

    return this.prismaService.message.create({
      data: {
        chatId: params.chatId,
        content: params.content,
        senderType,
        senderId: params.user.id,
      },
    });
  }

  async assignOperator(chatId: string) {
    const operator = await this.prismaService.operatorProfile.findFirst({
      where: {
        status: 'AVAILABLE',
        isActive: true,
      },
      orderBy: { updatedAt: 'asc' }, // простой round-robin
    });

    if (!operator) {
      await this.prismaService.chat.update({
        where: { id: chatId },
        data: { status: 'WAITING_OPERATOR' },
      });
      return;
    }

    await this.prismaService.$transaction([
      this.prismaService.chat.update({
        where: { id: chatId },
        data: {
          operatorId: operator.id,
          status: 'OPERATOR_ACTIVE',
        },
      }),
      this.prismaService.operatorProfile.update({
        where: { id: operator.id },
        data: { status: 'BUSY' },
      }),
    ]);

    return operator;
  }

  async inviteOperator(email: string) {
    const existingOperator = this.prismaService.user.findUnique({
      where: { email },
    });

    if (existingOperator) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }

    const token = uuidv4();
    const expiresIn = new Date(new Date().getTime() + 3600 * 1000);

    const inviteToken = await this.prismaService.token.create({
      data: {
        email,
        token,
        expiresIn,
        type: TokenType.INVITE,
      },
    });

    const newOperator = await this.prismaService.user.create({
      data: {
        email,
        role: 'Manager',
        password: null,
        isGuest: false,
        operatorProfile: {
          create: {
            inviteToken: token,
            inviteExpires: expiresIn,
            isActive: false,
            status: 'AVAILABLE',
          },
        },
      },
      include: {
        operatorProfile: true,
      },
    });

    await this.emailService.sendInviteOperatorEmail(
      newOperator.email,
      inviteToken.token,
    );

    return {
      userId: newOperator.id,
      email: newOperator.email,
      inviteToken,
      expiresAt: expiresIn,
    };
  }

  async activateOperator(token: string, passwordHash: string, name: string) {
    const operatorProfile = await this.prismaService.operatorProfile.findUnique(
      {
        where: {
          inviteToken: token,
        },
        include: { user: true },
      },
    );

    if (!operatorProfile) {
      throw new BadRequestException({
        message: 'Пригласительный токен не валиден',
      });
    }

    if (
      !operatorProfile.inviteExpires ||
      operatorProfile.inviteExpires < new Date()
    ) {
      throw new BadRequestException({
        message: 'У токена истек срок действия',
      });
    }

    await this.prismaService.user.update({
      where: { id: operatorProfile.userId },
      data: {
        password: await hash(passwordHash),
        name: name,
      },
    });

    await this.prismaService.operatorProfile.update({
      where: { id: operatorProfile.id },
      data: {
        isActive: true,
        inviteToken: null,
        inviteExpires: null,
      },
    });
  }
}
