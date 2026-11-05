import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { v5 as uuidv5 } from 'uuid';

import {
  ChatMode,
  ConversationMessageRole,
  OperatorStatus,
  Prisma,
  Role,
  SupportCaseKind,
  SupportCaseReason,
  SupportCaseStatus,
  type Message,
} from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import type { HandoffContext } from '@/src/support-agent/agents/handoff-agent/schemas/handoff.schema';

const RECEIPT_NAMESPACE = '93e9459e-bd62-4a8d-ae0f-a71b0ff4aa11';

const AVAILABILITY_LEASE_MS = 90_000;

type Transaction = Prisma.TransactionClient;

type LockedChat = {
  id: string;
  userId: string;
  operatorId: string | null;
  mode: ChatMode;
  handoffVersion: number;
};

export interface HandoffTransition {
  chatId: string;
  caseId: string;
  mode: ChatMode;
  operatorId: string | null;
  handoffVersion: number;
  status: SupportCaseStatus;
  message: Message;
  replayed: boolean;
}

export interface RequestHandoffInput {
  chatId: string;
  userId: string;
  requestId: string;
  expectedVersion?: number;
  sourceMessageId?: string;
  reason?: SupportCaseReason;
  context?: HandoffContext | null;
}

@Injectable()
export class ChatHandoffService {
  constructor(private readonly prisma: PrismaService) {}

  async request(input: RequestHandoffInput): Promise<HandoffTransition> {
    return this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, input.chatId);

      this.assertOwner(chat, input.userId);

      /*
       * Повтор уже обработанной команды.
       * Даже если обращение впоследствии закрыли,
       * повтор не должен открывать новое.
       */
      const previous = await tx.supportCase.findUnique({
        where: {
          requestId: input.requestId,
        },
      });

      if (previous) {
        if (
          previous.chatId !== chat.id ||
          previous.userId !== input.userId ||
          previous.kind !== SupportCaseKind.HANDOFF
        ) {
          throw new ConflictException(
            'Идентификатор команды уже используется.',
          );
        }

        const message = await this.getCurrentReceipt(
          tx,
          previous.id,
          previous.status,
        );

        return this.transition(
          chat,
          previous.id,
          previous.status,
          message,
          true,
        );
      }

      /*
       * Защита от запоздавшего AI-результата.
       * Версию запоминаем до запуска AI
       * и проверяем перед реальной передачей.
       */
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== chat.handoffVersion
      ) {
        throw new ConflictException(
          'Состояние чата изменилось во время обработки запроса.',
        );
      }

      /*
       * Одновременно может существовать
       * только одно активное операторское
       * обращение этого постоянного чата.
       */
      const active = await this.activeCase(tx, chat.id);

      if (active) {
        const message = await this.getCurrentReceipt(
          tx,
          active.id,
          active.status,
        );

        return this.transition(chat, active.id, active.status, message, true);
      }

      if (chat.mode !== ChatMode.BOT || chat.operatorId !== null) {
        throw new ConflictException('Чат уже находится вне режима AI.');
      }

      if (input.sourceMessageId) {
        const source = await tx.message.findUnique({
          where: {
            id: input.sourceMessageId,
          },
        });

        if (
          !source ||
          source.chatId !== chat.id ||
          source.authorId !== chat.userId ||
          source.role !== ConversationMessageRole.USER
        ) {
          throw new ForbiddenException(
            'Исходное сообщение не принадлежит покупателю.',
          );
        }
      }

      /*
       * Сначала проверяем существующую очередь.
       * Новое обращение не обходит уже ожидающие.
       */
      const waitingAhead = await tx.supportCase.findFirst({
        where: {
          kind: SupportCaseKind.HANDOFF,
          status: SupportCaseStatus.WAITING_OPERATOR,
          chat: {
            mode: ChatMode.WAITING_OPERATOR,
          },
        },
        select: {
          id: true,
        },
      });

      const operator = waitingAhead
        ? null
        : await this.claimAvailableOperator(tx);

      const assigned = operator !== null;

      const mode = assigned ? ChatMode.OPERATOR : ChatMode.WAITING_OPERATOR;

      const status = assigned
        ? SupportCaseStatus.IN_PROGRESS
        : SupportCaseStatus.WAITING_OPERATOR;

      const supportCase = await tx.supportCase.create({
        data: {
          userId: chat.userId,
          chatId: chat.id,
          operatorId: operator?.id ?? null,
          kind: SupportCaseKind.HANDOFF,
          requestId: input.requestId,
          sourceMessageId: input.sourceMessageId ?? null,
          reason: input.reason ?? SupportCaseReason.CUSTOMER_REQUEST,
          issue: input.context?.issue || 'Покупатель запросил оператора',
          context: input.context
            ? (input.context as Prisma.InputJsonValue)
            : undefined,
          status,
        },
      });

      const updatedChat = await tx.chat.update({
        where: {
          id: chat.id,
        },
        data: {
          mode,
          operatorId: operator?.id ?? null,
          handoffVersion: {
            increment: 1,
          },
        },
      });

      const message = await this.createReceipt(
        tx,
        updatedChat.id,
        supportCase.id,
        'request',
        status,
        mode,
      );

      return {
        chatId: updatedChat.id,
        caseId: supportCase.id,
        mode: updatedChat.mode,
        operatorId: updatedChat.operatorId,
        handoffVersion: updatedChat.handoffVersion,
        status,
        message,
        replayed: false,
      };
    });
  }

  async getWaitingCaseIds(limit = 25): Promise<string[]> {
    const cases = await this.prisma.supportCase.findMany({
      where: {
        kind: SupportCaseKind.HANDOFF,
        status: SupportCaseStatus.WAITING_OPERATOR,
        chat: {
          mode: ChatMode.WAITING_OPERATOR,
          operatorId: null,
        },
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      take: limit,
      select: {
        id: true,
      },
    });

    return cases.map((item) => item.id);
  }

  async assignWaiting(caseId: string): Promise<HandoffTransition | null> {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.supportCase.findUnique({
        where: {
          id: caseId,
        },
        select: {
          chatId: true,
        },
      });

      if (!original) {
        return null;
      }

      const chat = await this.lockChat(tx, original.chatId);

      const supportCase = await tx.supportCase.findUnique({
        where: {
          id: caseId,
        },
      });

      if (
        !supportCase ||
        supportCase.kind !== SupportCaseKind.HANDOFF ||
        supportCase.status !== SupportCaseStatus.WAITING_OPERATOR ||
        chat.mode !== ChatMode.WAITING_OPERATOR ||
        chat.operatorId !== null ||
        supportCase.operatorId !== null
      ) {
        return null;
      }

      const active = await this.activeCase(tx, chat.id);

      if (!active || active.id !== supportCase.id) {
        throw new ConflictException('Состояние очереди не согласовано.');
      }

      const operator = await this.claimAvailableOperator(tx);

      if (!operator) {
        return null;
      }

      await tx.supportCase.update({
        where: {
          id: supportCase.id,
        },
        data: {
          operatorId: operator.id,
          status: SupportCaseStatus.IN_PROGRESS,
        },
      });

      const updatedChat = await tx.chat.update({
        where: {
          id: chat.id,
        },
        data: {
          mode: ChatMode.OPERATOR,
          operatorId: operator.id,
        },
      });

      const message = await this.createReceipt(
        tx,
        chat.id,
        supportCase.id,
        'assigned',
        SupportCaseStatus.IN_PROGRESS,
        ChatMode.OPERATOR,
      );

      return {
        chatId: chat.id,
        caseId: supportCase.id,
        mode: updatedChat.mode,
        operatorId: updatedChat.operatorId,
        handoffVersion: updatedChat.handoffVersion,
        status: SupportCaseStatus.IN_PROGRESS,
        message,
        replayed: false,
      };
    });
  }

  async finish(
    caseId: string,
    operatorUserId: string,
  ): Promise<HandoffTransition> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supportCase.findUnique({
        where: {
          id: caseId,
        },
      });

      if (!existing || existing.kind !== SupportCaseKind.HANDOFF) {
        throw new NotFoundException('Операторское обращение не найдено.');
      }

      const chat = await this.lockChat(tx, existing.chatId);

      const operator = await this.getStaffProfile(tx, operatorUserId);

      if (existing.operatorId !== operator.id) {
        throw new ForbiddenException(
          'Обращение не назначено этому сотруднику.',
        );
      }

      if (existing.status === SupportCaseStatus.RESOLVED) {
        const message = await this.getReceipt(tx, caseId, 'finished');

        return this.transition(chat, caseId, existing.status, message, true);
      }

      const active = await this.activeCase(tx, chat.id);

      if (
        !active ||
        active.id !== caseId ||
        active.status !== SupportCaseStatus.IN_PROGRESS ||
        chat.mode !== ChatMode.OPERATOR ||
        chat.operatorId !== operator.id
      ) {
        throw new ConflictException(
          'Обращение не находится в работе сотрудника.',
        );
      }

      await tx.supportCase.update({
        where: {
          id: caseId,
        },
        data: {
          status: SupportCaseStatus.RESOLVED,
          closedAt: new Date(),
        },
      });

      const updatedChat = await tx.chat.update({
        where: {
          id: chat.id,
        },
        data: {
          mode: ChatMode.BOT,
          operatorId: null,
          handoffVersion: {
            increment: 1,
          },
        },
      });

      /*
       * Если сотрудник по-прежнему подтвердил
       * доступность, он снова может получать
       * обращения.
       *
       * Иначе переходит в OFFLINE.
       */
      const online =
        operator.availableUntil !== null &&
        operator.availableUntil > new Date() &&
        operator.status !== OperatorStatus.OFFLINE;

      await tx.operatorProfile.update({
        where: {
          id: operator.id,
        },
        data: {
          status: online ? OperatorStatus.AVAILABLE : OperatorStatus.OFFLINE,
          availableUntil: online ? operator.availableUntil : null,
        },
      });

      const message = await this.createReceipt(
        tx,
        chat.id,
        caseId,
        'finished',
        SupportCaseStatus.RESOLVED,
        ChatMode.BOT,
      );

      return {
        chatId: chat.id,
        caseId,
        mode: updatedChat.mode,
        operatorId: null,
        handoffVersion: updatedChat.handoffVersion,
        status: SupportCaseStatus.RESOLVED,
        message,
        replayed: false,
      };
    });
  }

  /**
   * Покупатель отменяет ожидание оператора.
   *
   * Только WAITING_OPERATOR, без назначенного сотрудника.
   * Транзакция с блокировкой чата защищает от гонки с assignWaiting().
   */
  async cancelWaiting(
    chatId: string,
    userId: string,
  ): Promise<HandoffTransition> {
    return this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, chatId);

      this.assertOwner(chat, userId);

      if (chat.mode !== ChatMode.WAITING_OPERATOR || chat.operatorId !== null) {
        throw new ConflictException(
          'Ожидание оператора уже завершено или оператор подключён.',
        );
      }

      const active = await this.activeCase(tx, chat.id);

      if (
        !active ||
        active.kind !== SupportCaseKind.HANDOFF ||
        active.status !== SupportCaseStatus.WAITING_OPERATOR ||
        active.operatorId !== null
      ) {
        throw new ConflictException('Активное ожидающее обращение не найдено.');
      }

      await tx.supportCase.update({
        where: {
          id: active.id,
        },
        data: {
          status: SupportCaseStatus.CANCELLED,
          closedAt: new Date(),
        },
      });

      const updatedChat = await tx.chat.update({
        where: {
          id: chat.id,
        },
        data: {
          mode: ChatMode.BOT,
          operatorId: null,
          handoffVersion: {
            increment: 1,
          },
        },
      });

      const message = await this.createReceipt(
        tx,
        chat.id,
        active.id,
        'cancelled',
        SupportCaseStatus.CANCELLED,
        ChatMode.BOT,
      );

      return {
        chatId: chat.id,
        caseId: active.id,
        mode: updatedChat.mode,
        operatorId: null,
        handoffVersion: updatedChat.handoffVersion,
        status: SupportCaseStatus.CANCELLED,
        message,
        replayed: false,
      };
    });
  }

  async setAvailability(operatorUserId: string, available: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const operator = await this.getStaffProfile(tx, operatorUserId);

      /*
       * Сериализуем изменения доступности
       * конкретного сотрудника.
       */
      await tx.$queryRaw`
        SELECT "id"
        FROM "OperatorProfile"
        WHERE "id" = ${operator.id}
        FOR UPDATE
      `;

      const activeChats = await tx.chat.count({
        where: {
          operatorId: operator.id,
          mode: ChatMode.OPERATOR,
        },
      });

      const status = !available
        ? OperatorStatus.OFFLINE
        : activeChats > 0
        ? OperatorStatus.BUSY
        : OperatorStatus.AVAILABLE;

      const availableUntil = available
        ? new Date(Date.now() + AVAILABILITY_LEASE_MS)
        : null;

      return tx.operatorProfile.update({
        where: {
          id: operator.id,
        },
        data: {
          status,
          availableUntil,
        },
        select: {
          id: true,
          status: true,
          availableUntil: true,
        },
      });
    });
  }

  async getOperatorInbox(operatorUserId: string) {
    const operator = await this.getStaffProfile(this.prisma, operatorUserId);

    return this.prisma.supportCase.findMany({
      where: {
        kind: SupportCaseKind.HANDOFF,
        status: SupportCaseStatus.IN_PROGRESS,
        operatorId: operator.id,
        chat: {
          mode: ChatMode.OPERATOR,
          operatorId: operator.id,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        chatId: true,
        issue: true,
        createdAt: true,
        status: true,
      },
    });
  }

  async getOperatorCase(caseId: string, operatorUserId: string) {
    const operator = await this.getStaffProfile(this.prisma, operatorUserId);

    const supportCase = await this.prisma.supportCase.findFirst({
      where: {
        id: caseId,
        kind: SupportCaseKind.HANDOFF,
        status: SupportCaseStatus.IN_PROGRESS,
        operatorId: operator.id,
        chat: {
          mode: ChatMode.OPERATOR,
          operatorId: operator.id,
        },
      },
      select: {
        id: true,
        chatId: true,
        reason: true,
        issue: true,
        context: true,
        sourceMessageId: true,
        createdAt: true,
      },
    });

    if (!supportCase) {
      throw new ForbiddenException('Нет доступа к этому обращению.');
    }

    return supportCase;
  }

  async getCustomerSnapshot(chatId: string, userId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: {
        id: chatId,
      },
      select: {
        id: true,
        userId: true,
        mode: true,
        handoffVersion: true,
        operatorId: true,
      },
    });

    if (!chat || chat.userId !== userId) {
      throw new ForbiddenException('Нет доступа к этому чату.');
    }

    const active = await this.prisma.supportCase.findFirst({
      where: {
        chatId,
        kind: SupportCaseKind.HANDOFF,
        status: {
          in: [
            SupportCaseStatus.WAITING_OPERATOR,
            SupportCaseStatus.IN_PROGRESS,
          ],
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      chatId: chat.id,
      mode: chat.mode,
      handoffVersion: chat.handoffVersion,
      operatorId: chat.operatorId,
      caseId: active?.id ?? null,
      caseStatus: active?.status ?? null,
    };
  }

  private async lockChat(tx: Transaction, chatId: string): Promise<LockedChat> {
    const rows = await tx.$queryRaw<LockedChat[]>`
      SELECT
        "id",
        "userId",
        "operatorId",
        "mode",
        "handoffVersion"
      FROM "Chat"
      WHERE "id" = ${chatId}
      FOR UPDATE
    `;

    if (rows.length !== 1) {
      throw new NotFoundException('Чат не найден.');
    }

    return rows[0];
  }

  private assertOwner(chat: LockedChat, userId: string) {
    if (chat.userId !== userId) {
      throw new ForbiddenException('Чат не принадлежит пользователю.');
    }
  }

  private async activeCase(tx: Transaction, chatId: string) {
    const cases = await tx.supportCase.findMany({
      where: {
        chatId,
        kind: SupportCaseKind.HANDOFF,
        status: {
          in: [
            SupportCaseStatus.WAITING_OPERATOR,
            SupportCaseStatus.IN_PROGRESS,
          ],
        },
      },
      take: 2,
    });

    if (cases.length > 1) {
      throw new ConflictException(
        'Для чата найдено несколько активных обращений.',
      );
    }

    return cases[0] ?? null;
  }

  private async getStaffProfile(tx: Transaction, operatorUserId: string) {
    const operator = await tx.operatorProfile.findUnique({
      where: {
        userId: operatorUserId,
      },
      include: {
        user: {
          select: {
            role: true,
          },
        },
      },
    });

    if (
      !operator ||
      !operator.isActive ||
      (operator.user.role !== Role.Manager && operator.user.role !== Role.Admin)
    ) {
      throw new ForbiddenException('Требуется активный профиль сотрудника.');
    }

    return operator;
  }

  private async claimAvailableOperator(tx: Transaction) {
    const now = new Date();

    const candidate = await tx.operatorProfile.findFirst({
      where: {
        status: OperatorStatus.AVAILABLE,
        isActive: true,
        availableUntil: {
          gt: now,
        },
        user: {
          role: {
            in: [Role.Manager, Role.Admin],
          },
        },
        chats: {
          none: {
            mode: ChatMode.OPERATOR,
          },
        },
      },
      orderBy: [
        {
          updatedAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    if (!candidate) {
      return null;
    }

    const claimed = await tx.operatorProfile.updateMany({
      where: {
        id: candidate.id,
        status: OperatorStatus.AVAILABLE,
        isActive: true,
        availableUntil: {
          gt: new Date(),
        },
        chats: {
          none: {
            mode: ChatMode.OPERATOR,
          },
        },
      },
      data: {
        status: OperatorStatus.BUSY,
      },
    });

    if (claimed.count !== 1) {
      return null;
    }

    return candidate;
  }

  private receiptId(
    caseId: string,
    operation: 'request' | 'assigned' | 'finished' | 'cancelled',
  ) {
    return uuidv5(`chat-handoff:${operation}:${caseId}`, RECEIPT_NAMESPACE);
  }

  private async getReceipt(
    tx: Transaction,
    caseId: string,
    operation: 'request' | 'assigned' | 'finished' | 'cancelled',
  ) {
    const message = await tx.message.findUnique({
      where: {
        id: this.receiptId(caseId, operation),
      },
    });

    if (!message) {
      throw new ConflictException('Подтверждение операции не найдено.');
    }

    return message;
  }

  private async getCurrentReceipt(
    tx: Transaction,
    caseId: string,
    status: SupportCaseStatus,
  ) {
    if (status === SupportCaseStatus.RESOLVED) {
      return this.getReceipt(tx, caseId, 'finished');
    }

    if (status === SupportCaseStatus.CANCELLED) {
      const cancelled = await tx.message.findUnique({
        where: {
          id: this.receiptId(caseId, 'cancelled'),
        },
      });

      // Старые обращения могли быть отменены вручную, без receipt.
      return cancelled ?? this.getReceipt(tx, caseId, 'request');
    }

    if (status === SupportCaseStatus.IN_PROGRESS) {
      const assigned = await tx.message.findUnique({
        where: {
          id: this.receiptId(caseId, 'assigned'),
        },
      });

      if (assigned) {
        return assigned;
      }
    }

    return this.getReceipt(tx, caseId, 'request');
  }

  private async createReceipt(
    tx: Transaction,
    chatId: string,
    caseId: string,
    operation: 'request' | 'assigned' | 'finished' | 'cancelled',
    status: SupportCaseStatus,
    mode: ChatMode,
  ) {
    const content =
      operation === 'finished'
        ? 'Работа оператора завершена. AI-ассистент снова доступен.'
        : operation === 'cancelled'
        ? 'Ожидание оператора отменено. AI-ассистент снова доступен.'
        : status === SupportCaseStatus.IN_PROGRESS
        ? 'Оператор назначен вашему обращению.'
        : 'Обращение зарегистрировано и ожидает оператора.';

    const message = await tx.message.create({
      data: {
        id: this.receiptId(caseId, operation),
        chatId,
        role: ConversationMessageRole.ASSISTANT,
        content,
        payload: {
          blocks: [],
          handoff: {
            caseId,
            status,
            mode,
            operation,
          },
        },
      },
    });

    await tx.chat.update({
      where: {
        id: chatId,
      },
      data: {
        lastMessageAt: message.createdAt,
      },
    });

    return message;
  }

  private transition(
    chat: LockedChat,
    caseId: string,
    status: SupportCaseStatus,
    message: Message,
    replayed: boolean,
  ): HandoffTransition {
    return {
      chatId: chat.id,
      caseId,
      mode: chat.mode,
      operatorId: chat.operatorId,
      handoffVersion: chat.handoffVersion,
      status,
      message,
      replayed,
    };
  }
}
