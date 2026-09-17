// import {
//   BadRequestException,
//   ConflictException,
//   ForbiddenException,
//   Injectable,
//   NotFoundException,
// } from '@nestjs/common';

// import { UserService } from '../user/user.service';
// import { PrismaService } from '@/src/core/prisma/prisma.service';
// import { WsUser } from './entities/ws-user.entity';
// import { v4 as uuidv4 } from 'uuid';
// import { ChatMode, TokenType } from '@/prisma/generated';
// import { MailService } from '@/src/mail/mail.service';
// import { hash } from 'argon2';

// @Injectable()
// export class ChatService {
//   constructor(
//     private readonly userService: UserService,
//     private readonly prismaService: PrismaService,
//     private readonly emailService: MailService,
//   ) {}

//   async assertUserCanAccessChat(user: WsUser, chatId: string) {
//     const chat = await this.prismaService.chat.findUnique({
//       where: { id: chatId },
//       select: {
//         userId: true,
//         operator: { select: { userId: true } },
//       },
//     });

//     if (!chat) {
//       throw new ForbiddenException('Чат не найден');
//     }

//     if (chat.userId !== user.id && chat.operator?.userId !== user.id) {
//       throw new ForbiddenException('У вас нет доступа к этому чату!');
//     }
//   }

//   async findChatByUserId(userId: string) {
//     return await this.prismaService.chat.findUnique({
//       where: {
//         userId,
//       },
//       include: {
//         messages: {
//           orderBy: {
//             createdAt: 'asc',
//           },
//         },
//       },
//     });
//   }

//   // async createChatWithGreeting(userId: string) {
//   //   const user = await this.prismaService.user.findUnique({
//   //     where: {
//   //       id: userId,
//   //     },
//   //   });

//   //   if (!user) {
//   //     throw new NotFoundException({ message: 'Пользователь не найден' });
//   //   }

//   //   const newChat = await this.prismaService.chat.create({
//   //     data: {
//   //       userId,
//   //       mode: ChatMode.BOT,
//   //     },
//   //   });
//   //   return {
//   //     newChat,
//   //   };
//   // }
//   // async startChat(userId: string) {
//   //   const existingChat = await this.findChatByUserId(userId);
//   //   const user = await this.prismaService.user.findUnique({
//   //     where: {
//   //       id: userId,
//   //     },
//   //   });
//   //   if (existingChat) {
//   //     return {
//   //       chat: existingChat,
//   //       greeting: `Привет ${user.name}! Чем я могу помочь сегодня?`,
//   //     };
//   //   }

//   //   const newChat = await this.createChatWithGreeting(userId);

//   //   return {
//   //     chat: newChat,
//   //     greeting: `Привет ${user.name}. Я AI-ассистент магазина lamoda. Чем я могу вам помочь?`,
//   //   };
//   // }

//   async createChatWithGreeting(userId: string) {
//     const user = await this.prismaService.user.findUnique({
//       where: {
//         id: userId,
//       },
//       select: {
//         name: true,
//       },
//     });

//     if (!user) {
//       throw new NotFoundException({
//         message: 'Пользователь не найден',
//       });
//     }

//     // ===== ИЗМЕНЕНО: первое, расширенное приветствие =====
//     const greeting = user.name
//       ? `Привет, ${user.name}! Я AI-ассистент магазина. Я могу помочь найти товар, ответить на вопросы о доставке или проверить статус заказа. Чем могу помочь?`
//       : 'Привет! Я AI-ассистент магазина. Я могу помочь найти товар, ответить на вопросы о доставке или проверить статус заказа. Чем могу помочь?';

//     return this.prismaService.chat.create({
//       data: {
//         userId,
//         mode: ChatMode.BOT,

//         // ===== НОВОЕ: приветствие сразу сохраняется как Message =====
//         messages: {
//           create: {
//             role: 'ASSISTANT',
//             content: greeting,
//           },
//         },
//       },

//       include: {
//         messages: {
//           orderBy: {
//             createdAt: 'asc',
//           },
//         },
//       },
//     });
//   }

//   async startChat(userId: string) {
//     const existingChat = await this.findChatByUserId(userId);

//     if (!existingChat) {
//       return this.createChatWithGreeting(userId);
//     }

//     const user = await this.prismaService.user.findUnique({
//       where: {
//         id: userId,
//       },
//       select: {
//         name: true,
//       },
//     });

//     if (!user) {
//       throw new NotFoundException({
//         message: 'Пользователь не найден',
//       });
//     }

//     const greeting = user.name
//       ? `Привет, ${user.name}! Чем могу помочь?`
//       : 'Привет! Чем могу помочь?';

//     await this.prismaService.message.create({
//       data: {
//         chatId: existingChat.id,
//         role: 'ASSISTANT',
//         content: greeting,
//       },
//     });

//     return this.findChatByUserId(userId);
//   }

//   async createMessage(params: {
//     chatId: string;
//     content: string;
//     user: WsUser;
//   }) {
//     const senderType = params.user.role === 'Manager' ? 'OPERATOR' : 'USER';

//     return this.prismaService.message.create({
//       data: {
//         chatId: params.chatId,
//         content: params.content,
//         role: senderType,
//         authorId: params.user.id,
//       },
//     });
//   }

//   async assignOperator(chatId: string) {
//     const operator = await this.prismaService.operatorProfile.findFirst({
//       where: {
//         status: 'AVAILABLE',
//         isActive: true,
//       },
//       orderBy: { updatedAt: 'asc' }, // простой round-robin
//     });

//     if (!operator) {
//       await this.prismaService.chat.update({
//         where: { id: chatId },
//         data: { mode: 'WAITING_OPERATOR' },
//       });
//       return;
//     }

//     await this.prismaService.$transaction([
//       this.prismaService.chat.update({
//         where: { id: chatId },
//         data: {
//           operatorId: operator.id,
//           mode: 'OPERATOR',
//         },
//       }),
//       this.prismaService.operatorProfile.update({
//         where: { id: operator.id },
//         data: { status: 'BUSY' },
//       }),
//     ]);

//     return operator;
//   }

//   async inviteOperator(email: string) {
//     const existingOperator = this.prismaService.user.findUnique({
//       where: { email },
//     });

//     if (existingOperator) {
//       throw new ConflictException('Пользователь с таким email уже существует');
//     }

//     const token = uuidv4();
//     const expiresIn = new Date(new Date().getTime() + 3600 * 1000);

//     const inviteToken = await this.prismaService.token.create({
//       data: {
//         email,
//         token,
//         expiresIn,
//         type: TokenType.INVITE,
//       },
//     });

//     const newOperator = await this.prismaService.user.create({
//       data: {
//         email,
//         role: 'Manager',
//         password: null,
//         operatorProfile: {
//           create: {
//             inviteToken: token,
//             inviteExpires: expiresIn,
//             isActive: false,
//             status: 'AVAILABLE',
//           },
//         },
//       },
//       include: {
//         operatorProfile: true,
//       },
//     });

//     await this.emailService.sendInviteOperatorEmail(
//       newOperator.email,
//       inviteToken.token,
//     );

//     return {
//       userId: newOperator.id,
//       email: newOperator.email,
//       inviteToken,
//       expiresAt: expiresIn,
//     };
//   }

//   async activateOperator(token: string, passwordHash: string, name: string) {
//     const operatorProfile = await this.prismaService.operatorProfile.findUnique(
//       {
//         where: {
//           inviteToken: token,
//         },
//         include: { user: true },
//       },
//     );

//     if (!operatorProfile) {
//       throw new BadRequestException({
//         message: 'Пригласительный токен не валиден',
//       });
//     }

//     if (
//       !operatorProfile.inviteExpires ||
//       operatorProfile.inviteExpires < new Date()
//     ) {
//       throw new BadRequestException({
//         message: 'У токена истек срок действия',
//       });
//     }

//     await this.prismaService.user.update({
//       where: { id: operatorProfile.userId },
//       data: {
//         password: await hash(passwordHash),
//         name: name,
//       },
//     });

//     await this.prismaService.operatorProfile.update({
//       where: { id: operatorProfile.id },
//       data: {
//         isActive: true,
//         inviteToken: null,
//         inviteExpires: null,
//       },
//     });
//   }
// }

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

      // ===== ИЗМЕНЕНО =====
      // mode понадобится Gateway, чтобы понять,
      // должен ли сейчас отвечать BOT.
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

    // ===== НОВОЕ =====
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
      // const greeting =
      //   `Привет, ${dbUser.name ?? 'пользователь'}! ` +
      //   'Чем могу помочь сегодня?';

      // await this.createMessage({
      //   chatId: existingChat.id,
      //   content: greeting,
      //   role: ConversationMessageRole.ASSISTANT,

      //   payload: {
      //     blocks: [],
      //   } as Prisma.InputJsonValue,
      // });

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
