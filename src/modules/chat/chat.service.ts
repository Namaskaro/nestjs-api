import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { hash } from 'argon2';
import { v4 as uuidv4 } from 'uuid';

import {
  ChatMode,
  ConversationMessageRole,
  OperatorStatus,
  Prisma,
  Role,
  TokenType,
} from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';
import { MailService } from '@/src/mail/mail.service';

import { UserService } from '../user/user.service';

import { WsUser } from './entities/ws-user.entity';

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function patchConsultationFeedbackPayload(
  payload: Prisma.JsonValue | null,
  params: {
    sessionId: string;
    helpful: boolean;
    submittedAt: string;
  },
): Prisma.InputJsonValue | null {
  if (!isJsonObject(payload)) {
    return null;
  }

  const blocks = payload.blocks;

  if (!Array.isArray(blocks)) {
    return null;
  }

  let matched = false;

  const nextBlocks = blocks.map((block) => {
    if (!isJsonObject(block)) {
      return block;
    }

    const data = block.data;

    if (!isJsonObject(data)) {
      return block;
    }

    const completion = data.consultationCompletion;

    if (
      !isJsonObject(completion) ||
      completion.sessionId !== params.sessionId
    ) {
      return block;
    }

    matched = true;

    return {
      ...block,

      data: {
        ...data,

        consultationCompletion: {
          ...completion,

          feedback: {
            helpful: params.helpful,
            submittedAt: params.submittedAt,
          },
        },
      },
    };
  });

  if (!matched) {
    return null;
  }

  return {
    ...payload,
    blocks: nextBlocks,
  } as Prisma.InputJsonValue;
}

type LockedChat = {
  id: string;
  userId: string;
  operatorId: string | null;
  mode: ChatMode;
  handoffVersion: number;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly userService: UserService,
    private readonly prismaService: PrismaService,
    private readonly emailService: MailService,
  ) {}

  async assertUserCanAccessChat(user: WsUser, chatId: string) {
    const chat = await this.prismaService.chat.findUnique({
      where: {
        id: chatId,
      },

      select: {
        userId: true,
        mode: true,

        operator: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!chat) {
      throw new ForbiddenException('Чат не найден');
    }

    if (chat.userId !== user.id && chat.operator?.userId !== user.id) {
      throw new ForbiddenException('У вас нет доступа к этому чату!');
    }

    return chat;
  }

  async findChatByUserId(userId: string) {
    return this.prismaService.chat.findUnique({
      where: {
        userId,
      },

      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async startChat(user: WsUser) {
    const dbUser = await this.prismaService.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!dbUser) {
      throw new NotFoundException({
        message: 'Пользователь не найден',
      });
    }

    const existingChat = await this.findChatByUserId(user.id);

    if (existingChat) {
      const chat = await this.findChatByUserId(user.id);

      if (!chat) {
        throw new NotFoundException('Чат не найден');
      }

      return chat;
    }

    const greeting =
      `Привет, ${dbUser.name ?? 'пользователь'}! ` +
      'Я AI-ассистент магазина. ' +
      'Помогу найти товары, разобраться с заказом, ' +
      'доставкой, оплатой и другими вопросами.';

    return this.prismaService.chat.create({
      data: {
        userId: user.id,
        mode: ChatMode.BOT,

        messages: {
          create: {
            role: ConversationMessageRole.ASSISTANT,
            content: greeting,
          },
        },
      },

      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async createMessage(params: {
    chatId: string;
    content: string;
    role: ConversationMessageRole;
    authorId?: string | null;
    payload?: Prisma.InputJsonValue;
  }) {
    const [message] = await this.prismaService.$transaction([
      this.prismaService.message.create({
        data: {
          chatId: params.chatId,
          content: params.content,
          role: params.role,
          authorId: params.authorId ?? null,
          payload: params.payload,
        },
      }),

      this.prismaService.chat.update({
        where: {
          id: params.chatId,
        },

        data: {
          lastMessageAt: new Date(),
        },
      }),
    ]);

    return message;
  }

  /**
   * Сохраняет сообщение покупателя или оператора.
   *
   * Роль определяется по реальному назначению
   * в PostgreSQL, а не по данным frontend.
   */
  async createParticipantMessage(params: {
    chatId: string;
    userId: string;
    content: string;
    payload?: Prisma.InputJsonValue;
    requireBot?: boolean;
  }) {
    return this.prismaService.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedChat[]>`
        SELECT
          "id",
          "userId",
          "operatorId",
          "mode",
          "handoffVersion"
        FROM "Chat"
        WHERE "id" = ${params.chatId}
        FOR UPDATE
      `;

      const chat = rows[0];

      if (!chat) {
        throw new NotFoundException('Чат не найден.');
      }

      const isCustomer = chat.userId === params.userId;

      let operatorUserId: string | null = null;

      if (chat.operatorId) {
        const operator = await tx.operatorProfile.findUnique({
          where: {
            id: chat.operatorId,
          },
          select: {
            userId: true,
            isActive: true,
            user: {
              select: {
                role: true,
              },
            },
          },
        });

        if (
          operator?.isActive &&
          (operator.user.role === Role.Manager ||
            operator.user.role === Role.Admin)
        ) {
          operatorUserId = operator.userId;
        }
      }

      const isCurrentOperator =
        !isCustomer &&
        chat.mode === ChatMode.OPERATOR &&
        operatorUserId === params.userId;

      if (!isCustomer && !isCurrentOperator) {
        throw new ForbiddenException(
          'Нет права отправлять сообщения в этот чат.',
        );
      }

      if (params.requireBot && (!isCustomer || chat.mode !== ChatMode.BOT)) {
        throw new ConflictException(
          'AI-ассистент сейчас не управляет этим чатом.',
        );
      }

      const role = isCustomer
        ? ConversationMessageRole.USER
        : ConversationMessageRole.OPERATOR;

      const message = await tx.message.create({
        data: {
          chatId: chat.id,
          authorId: params.userId,
          role,
          content: params.content,
          payload: params.payload,
        },
      });

      await tx.chat.update({
        where: {
          id: chat.id,
        },
        data: {
          lastMessageAt: message.createdAt,
        },
      });

      return {
        message,
        shouldRunAssistant: isCustomer && chat.mode === ChatMode.BOT,
        handoffVersion: chat.handoffVersion,
        operatorUserId,
      };
    });
  }

  /**
   * Не позволяет опубликовать устаревший ответ AI,
   * если чат за время генерации передали оператору.
   */
  async createAssistantMessageIfCurrent(params: {
    chatId: string;
    userId: string;
    expectedHandoffVersion: number;
    content: string;
    payload?: Prisma.InputJsonValue;
  }) {
    return this.prismaService.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedChat[]>`
        SELECT
          "id",
          "userId",
          "operatorId",
          "mode",
          "handoffVersion"
        FROM "Chat"
        WHERE "id" = ${params.chatId}
        FOR UPDATE
      `;

      const chat = rows[0];

      if (!chat || chat.userId !== params.userId) {
        throw new ForbiddenException('Нет доступа к указанному чату.');
      }

      if (
        chat.mode !== ChatMode.BOT ||
        chat.operatorId !== null ||
        chat.handoffVersion !== params.expectedHandoffVersion
      ) {
        throw new ConflictException(
          'Результат AI устарел после изменения состояния чата.',
        );
      }

      const message = await tx.message.create({
        data: {
          chatId: chat.id,
          role: ConversationMessageRole.ASSISTANT,
          content: params.content,
          payload: params.payload,
        },
      });

      await tx.chat.update({
        where: {
          id: chat.id,
        },
        data: {
          lastMessageAt: message.createdAt,
        },
      });

      return message;
    });
  }

  async getOperatorUserId(operatorProfileId: string) {
    const operator = await this.prismaService.operatorProfile.findUnique({
      where: {
        id: operatorProfileId,
      },
      select: {
        userId: true,
      },
    });

    return operator?.userId ?? null;
  }

  async updateConsultationFeedbackMessage(params: {
    chatId: string;
    sessionId: string;
    helpful: boolean;
    submittedAt: string;
  }) {
    const messages = await this.prismaService.message.findMany({
      where: {
        chatId: params.chatId,
        role: ConversationMessageRole.ASSISTANT,
      },

      orderBy: {
        createdAt: 'desc',
      },

      take: 100,
    });

    for (const message of messages) {
      const payload = patchConsultationFeedbackPayload(message.payload, params);

      if (!payload) {
        continue;
      }

      return this.prismaService.message.update({
        where: {
          id: message.id,
        },

        data: {
          payload,
        },
      });
    }

    throw new NotFoundException(
      'Сообщение завершённой консультации не найдено.',
    );
  }

  /**
   * Старый метод сохраняем для совместимости.
   * Новый Gateway использует ChatHandoffService.
   *
   * Не следует вызывать этот метод из новых
   * операторских сценариев.
   */
  async assignOperator(chatId: string) {
    const operator = await this.prismaService.operatorProfile.findFirst({
      where: {
        status: 'AVAILABLE',
        isActive: true,
      },

      orderBy: {
        updatedAt: 'asc',
      },
    });

    if (!operator) {
      await this.prismaService.chat.update({
        where: {
          id: chatId,
        },

        data: {
          mode: 'WAITING_OPERATOR',
        },
      });

      return;
    }

    await this.prismaService.$transaction([
      this.prismaService.chat.update({
        where: {
          id: chatId,
        },

        data: {
          operatorId: operator.id,
          mode: 'OPERATOR',
        },
      }),

      this.prismaService.operatorProfile.update({
        where: {
          id: operator.id,
        },

        data: {
          status: 'BUSY',
        },
      }),
    ]);

    return operator;
  }

  /**
   * Приглашать сотрудников может только Admin.
   *
   * Приглашённый пользователь получает роль
   * Manager и активирует профиль по email.
   */
  async inviteOperator(email: string, adminUserId: string) {
    const administrator = await this.prismaService.user.findUnique({
      where: {
        id: adminUserId,
      },
      select: {
        role: true,
      },
    });

    if (administrator?.role !== Role.Admin) {
      throw new ForbiddenException(
        'Приглашать сотрудников может только администратор.',
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      throw new BadRequestException('Email обязателен.');
    }

    const existingOperator = await this.prismaService.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (existingOperator) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }

    const token = uuidv4();

    const expiresIn = new Date(Date.now() + 3600 * 1000);

    const result = await this.prismaService.$transaction(async (tx) => {
      const inviteToken = await tx.token.create({
        data: {
          email: normalizedEmail,
          token,
          expiresIn,
          type: TokenType.INVITE,
        },
      });

      const newOperator = await tx.user.create({
        data: {
          email: normalizedEmail,
          role: Role.Manager,
          password: null,

          operatorProfile: {
            create: {
              inviteToken: token,
              inviteExpires: expiresIn,
              isActive: false,
              status: OperatorStatus.OFFLINE,
            },
          },
        },
      });

      return {
        userId: newOperator.id,
        email: newOperator.email,
        inviteToken,
        expiresAt: expiresIn,
      };
    });

    await this.emailService.sendInviteOperatorEmail(normalizedEmail, token);

    return result;
  }

  /**
   * Приглашение подтверждает владение email.
   * После установки пароля сотрудник может войти
   * обычным способом.
   */
  async activateOperator(token: string, passwordHash: string, name: string) {
    if (passwordHash.length < 6) {
      throw new BadRequestException(
        'Пароль должен содержать не менее 6 символов.',
      );
    }

    const operatorProfile = await this.prismaService.operatorProfile.findUnique(
      {
        where: {
          inviteToken: token,
        },
        include: {
          user: true,
        },
      },
    );

    if (!operatorProfile || operatorProfile.isActive) {
      throw new BadRequestException('Пригласительный токен недействителен.');
    }

    if (
      !operatorProfile.inviteExpires ||
      operatorProfile.inviteExpires < new Date()
    ) {
      throw new BadRequestException('У токена истёк срок действия.');
    }

    const password = await hash(passwordHash);

    await this.prismaService.$transaction(async (tx) => {
      const updated = await tx.operatorProfile.updateMany({
        where: {
          id: operatorProfile.id,
          inviteToken: token,
          isActive: false,
          inviteExpires: {
            gt: new Date(),
          },
        },
        data: {
          isActive: true,
          status: OperatorStatus.OFFLINE,
          inviteToken: null,
          inviteExpires: null,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          'Приглашение уже использовано или истекло.',
        );
      }

      await tx.user.update({
        where: {
          id: operatorProfile.userId,
        },
        data: {
          password,
          name,
          emailVerified: true,
        },
      });

      await tx.token.deleteMany({
        where: {
          token,
          type: TokenType.INVITE,
        },
      });
    });

    return {
      success: true,
    };
  }
}
