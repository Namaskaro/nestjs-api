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
  Prisma,
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

  async inviteOperator(email: string) {
    const existingOperator = this.prismaService.user.findUnique({
      where: {
        email,
      },
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

        include: {
          user: true,
        },
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
      where: {
        id: operatorProfile.userId,
      },

      data: {
        password: await hash(passwordHash),
        name,
      },
    });

    await this.prismaService.operatorProfile.update({
      where: {
        id: operatorProfile.id,
      },

      data: {
        isActive: true,
        inviteToken: null,
        inviteExpires: null,
      },
    });
  }
}
