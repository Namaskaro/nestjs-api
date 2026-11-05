import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ChatMode, SupportCaseStatus } from '@/prisma/generated';

import type { Socket } from 'socket.io';

/**
 * Не загружаем настоящие AuthService, MailService,
 * Prisma и LangGraph.
 *
 * Проверяем только взаимодействие Gateway
 * с операторским Handoff.
 */
jest.mock('../../auth/guards/ws-jwt.guard', () => ({
  WsJwtGuard: class MockWsJwtGuard {},
}));

jest.mock('../chat.service', () => ({
  ChatService: class MockChatService {},
}));

jest.mock('../chat-handoff.service', () => ({
  ChatHandoffService: class MockChatHandoffService {},
}));

jest.mock('../chat-handoff-queue.service', () => ({
  ChatHandoffQueueService: class MockChatHandoffQueueService {},
}));

jest.mock('@/src/support-agent/support-agent.service', () => ({
  SupportAgentService: class MockSupportAgentService {},
}));

import { ChatGateway } from '../chat.gateway';

import type { ChatService } from '../chat.service';

import type {
  ChatHandoffService,
  HandoffTransition,
} from '../chat-handoff.service';

import type { ChatHandoffQueueService } from '../chat-handoff-queue.service';

import type { SupportAgentService } from '@/src/support-agent/support-agent.service';

describe('Support Agent Handoff flow', () => {
  const chatId = 'chat-1';
  const caseId = 'case-1';

  let gateway: ChatGateway;

  let getOperatorUserId: ReturnType<
    typeof jest.fn<(id: string) => Promise<string | null>>
  >;

  let synchronizeOperatorHandoff: ReturnType<
    typeof jest.fn<
      (
        chatId: string,
        caseId: string,
        status: SupportCaseStatus,
      ) => Promise<void>
    >
  >;

  let request: ReturnType<
    typeof jest.fn<(input: unknown) => Promise<HandoffTransition>>
  >;

  let finish: ReturnType<
    typeof jest.fn<
      (caseId: string, operatorUserId: string) => Promise<HandoffTransition>
    >
  >;

  let flush: ReturnType<typeof jest.fn<() => Promise<void>>>;

  let emit: ReturnType<
    typeof jest.fn<(event: string, payload: unknown) => void>
  >;

  let to: ReturnType<
    typeof jest.fn<
      (room: string) => {
        emit: typeof emit;
      }
    >
  >;

  beforeEach(() => {
    getOperatorUserId = jest
      .fn<(id: string) => Promise<string | null>>()
      .mockResolvedValue('operator-user');

    synchronizeOperatorHandoff = jest
      .fn<
        (
          chatId: string,
          caseId: string,
          status: SupportCaseStatus,
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    request = jest.fn<(input: unknown) => Promise<HandoffTransition>>();

    finish =
      jest.fn<
        (caseId: string, operatorUserId: string) => Promise<HandoffTransition>
      >();

    flush = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    emit = jest.fn<(event: string, payload: unknown) => void>();

    to = jest
      .fn<
        (room: string) => {
          emit: typeof emit;
        }
      >()
      .mockReturnValue({
        emit,
      });

    const chatService = {
      getOperatorUserId,
    };

    const supportAgentService = {
      synchronizeOperatorHandoff,
    };

    const handoffService = {
      request,
      finish,
    };

    const handoffQueue = {
      setAssignmentListener: jest.fn<(listener: unknown) => void>(),

      flush,
    };

    gateway = new ChatGateway(
      chatService as unknown as ChatService,
      supportAgentService as unknown as SupportAgentService,
      handoffService as unknown as ChatHandoffService,
      handoffQueue as unknown as ChatHandoffQueueService,
    );

    gateway.server = {
      to,
    } as unknown as ChatGateway['server'];

    gateway.onModuleInit();
  });

  it('AI Handoff создаёт обращение и уведомляет оператора', async () => {
    const transition = {
      chatId,
      caseId,
      mode: ChatMode.OPERATOR,
      operatorId: 'operator-profile-1',
      handoffVersion: 1,
      status: SupportCaseStatus.IN_PROGRESS,

      message: {
        id: 'receipt-1',
        content: 'Оператор назначен вашему обращению.',
      },

      replayed: false,
    } as HandoffTransition;

    request.mockResolvedValue(transition);

    const result = {
      kind: 'answer',

      answer: {
        type: 'customer_help',
        message: 'Передаю запрос оператору.',
      },

      handoff: {
        handoffMessage: 'Передаю запрос оператору.',
        reason: 'CUSTOMER_REQUEST',
        trigger: 'EXPLICIT_USER_REQUEST',
        context: null,
      },
    };

    const internalGateway = gateway as unknown as {
      handleAgentResult(
        chatId: string,
        result: unknown,
        userId: string,
        sourceMessageId: string,
        expectedVersion: number,
      ): Promise<void>;
    };

    await internalGateway.handleAgentResult(
      chatId,
      result,
      'customer-1',
      'message-1',
      0,
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        userId: 'customer-1',
        sourceMessageId: 'message-1',
        expectedVersion: 0,
        reason: 'CUSTOMER_REQUEST',
      }),
    );

    expect(synchronizeOperatorHandoff).toHaveBeenCalledWith(
      chatId,
      caseId,
      SupportCaseStatus.IN_PROGRESS,
    );

    expect(to).toHaveBeenCalledWith('operator:operator-user');

    expect(emit).toHaveBeenCalledWith(
      'operator:case_assigned',
      expect.objectContaining({
        chatId,
        caseId,
        mode: ChatMode.OPERATOR,
      }),
    );

    expect(emit).toHaveBeenCalledWith(
      'chat:status_changed',
      expect.objectContaining({
        chatId,
        mode: ChatMode.OPERATOR,
      }),
    );
  });

  it('завершение обращения возвращает чат в BOT', async () => {
    const transition = {
      chatId,
      caseId,
      mode: ChatMode.BOT,
      operatorId: null,
      handoffVersion: 2,
      status: SupportCaseStatus.RESOLVED,

      message: {
        id: 'receipt-2',
        content: 'Работа оператора завершена.',
      },

      replayed: false,
    } as HandoffTransition;

    finish.mockResolvedValue(transition);

    const socket = {
      data: {
        user: {
          id: 'operator-user',
        },
      },

      emit: jest.fn<(event: string, payload: unknown) => void>(),
    };

    await gateway.operatorFinish(socket as unknown as Socket, {
      caseId,
    });

    expect(finish).toHaveBeenCalledWith(caseId, 'operator-user');

    expect(synchronizeOperatorHandoff).toHaveBeenCalledWith(
      chatId,
      caseId,
      SupportCaseStatus.RESOLVED,
    );

    expect(emit).toHaveBeenCalledWith(
      'chat:status_changed',
      expect.objectContaining({
        chatId,
        mode: ChatMode.BOT,
        caseStatus: SupportCaseStatus.RESOLVED,
      }),
    );

    expect(socket.emit).toHaveBeenCalledWith('operator:case_finished', {
      caseId,
      chatId,
    });

    expect(flush).toHaveBeenCalled();
  });
});
