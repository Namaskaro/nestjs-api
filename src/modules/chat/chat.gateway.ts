import { Logger, UseGuards } from '@nestjs/common';

import {
  Ack,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';

import { ChatMode, ConversationMessageRole, Prisma } from '@/prisma/generated';

import { Server, Socket } from 'socket.io';

import {
  SupportAgentService,
  type SupportAgentStreamEvent,
} from '@/src/support-agent/support-agent.service';

import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { ChatService } from './chat.service';
import { JoinChatDto } from './dto/join-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';

// ===== START CHANGE: RETRY ТОЛЬКО ДЛЯ ВРЕМЕННЫХ ОШИБОК =====

function isRetryableAssistantError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    ['TimeoutError', 'APIConnectionError', 'RateLimitError'].includes(
      error.name,
    )
  ) {
    return true;
  }

  const status = (
    error as Error & {
      status?: number;
    }
  ).status;

  if (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500)
  ) {
    return true;
  }

  const cause = (
    error as Error & {
      cause?: {
        code?: string;
      };
    }
  ).cause;

  const code =
    (
      error as Error & {
        code?: string;
      }
    ).code ?? cause?.code;

  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(
    code ?? '',
  );
}

// ===== END CHANGE: RETRY ТОЛЬКО ДЛЯ ВРЕМЕННЫХ ОШИБОК =====

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL,

    credentials: true,
  },
})
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);

  private readonly activeAssistantChats = new Set<string>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly supportAgentService: SupportAgentService,
  ) {}

  @SubscribeMessage('chat:start')
  async chatStart(
    @ConnectedSocket()
    socket: Socket,
  ) {
    const chat = await this.chatService.startChat(socket.data.user);

    await socket.join(`chat:${chat.id}`);

    return chat;
  }

  @SubscribeMessage('chat:join')
  async joinChat(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: JoinChatDto,
  ) {
    await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    await socket.join(`chat:${dto.chatId}`);
  }

  @SubscribeMessage('chat:send_message')
  async sendMessage(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: SendMessageDto,

    @Ack()
    ack: (message: unknown) => void,
  ) {
    const chat = await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    const usesAssistant = chat.mode === ChatMode.BOT;

    if (usesAssistant) {
      this.acquireAssistantSlot(dto.chatId);
    }

    try {
      const userMessage = await this.chatService.createMessage({
        chatId: dto.chatId,

        content: dto.content,

        role: ConversationMessageRole.USER,

        authorId: socket.data.user.id,
      });

      this.server
        .to(`chat:${dto.chatId}`)
        .emit('chat:new_message', userMessage);

      ack(userMessage);

      if (!usesAssistant) {
        return;
      }

      // ===== START CHANGE: DB MESSAGE ID ИДЁТ В LANGGRAPH =====

      await this.runAssistant(dto.chatId, userMessage.content, userMessage.id);

      // ===== END CHANGE: DB MESSAGE ID ИДЁТ В LANGGRAPH =====
    } finally {
      if (usesAssistant) {
        this.releaseAssistantSlot(dto.chatId);
      }
    }
  }

  @SubscribeMessage('chat:retry_assistant')
  async retryAssistant(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: JoinChatDto,

    @Ack()
    ack: () => void,
  ) {
    const chat = await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    if (chat.mode !== ChatMode.BOT) {
      throw new WsException({
        status: 'conflict',

        message: 'AI-ассистент сейчас не управляет этим чатом.',
      });
    }

    this.acquireAssistantSlot(dto.chatId);

    try {
      const currentChat = await this.chatService.findChatByUserId(
        socket.data.user.id,
      );

      const lastMessage = currentChat?.messages.at(-1);

      if (
        !currentChat ||
        currentChat.id !== dto.chatId ||
        !lastMessage ||
        lastMessage.role !== ConversationMessageRole.USER
      ) {
        throw new WsException({
          status: 'bad_request',

          message: 'Нет сообщения, для которого можно повторить ответ.',
        });
      }

      ack();

      // ===== START CHANGE: RETRY НЕ ДУБЛИРУЕТ HUMAN MESSAGE В CHECKPOINT =====

      await this.runAssistant(dto.chatId, lastMessage.content, lastMessage.id);

      // ===== END CHANGE: RETRY НЕ ДУБЛИРУЕТ HUMAN MESSAGE В CHECKPOINT =====
    } finally {
      this.releaseAssistantSlot(dto.chatId);
    }
  }

  @SubscribeMessage('chat:request_operator')
  async requestOperator(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: JoinChatDto,
  ) {
    await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    const chat = await this.chatService.assignOperator(dto.chatId);

    this.server.to(`chat:${dto.chatId}`).emit('chat:status_changed', chat);
  }

  @SubscribeMessage('chat:clarification_resume')
  async resumeClarification(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: {
      chatId: string;

      value: Parameters<SupportAgentService['resume']>[0];
    },

    @Ack()
    ack: () => void,
  ) {
    await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    this.acquireAssistantSlot(dto.chatId);

    try {
      ack();

      const result = await this.supportAgentService.resume(
        dto.value,

        dto.chatId,

        (event) => this.emitAssistantEvent(dto.chatId, event),
      );

      await this.handleAgentResult(dto.chatId, result);
    } catch (error) {
      this.logger.error(error);

      this.emitAssistantError(dto.chatId, error, false);
    } finally {
      this.emitAssistantIdle(dto.chatId);

      this.releaseAssistantSlot(dto.chatId);
    }
  }

  private async runAssistant(
    chatId: string,
    content: string,
    messageId: string,
  ) {
    try {
      const result = await this.supportAgentService.run(
        content,

        chatId,

        (event) => this.emitAssistantEvent(chatId, event),

        messageId,
      );

      await this.handleAgentResult(chatId, result);
    } catch (error) {
      this.logger.error(error);

      // ===== START CHANGE: RETRYABILITY ЗАВИСИТ ОТ ОШИБКИ, А НЕ НОМЕРА ПОПЫТКИ =====

      this.emitAssistantError(chatId, error, true);

      // ===== END CHANGE: RETRYABILITY ЗАВИСИТ ОТ ОШИБКИ, А НЕ НОМЕРА ПОПЫТКИ =====
    } finally {
      this.emitAssistantIdle(chatId);
    }
  }

  private async handleAgentResult(
    chatId: string,

    result: Awaited<ReturnType<SupportAgentService['run']>>,
  ) {
    if (result.kind === 'interrupt') {
      this.server
        .to(`chat:${chatId}`)
        .emit('chat:clarification', result.interrupt);

      return;
    }

    // ===== START CHANGE: CONSULTATION ARTIFACTS СОХРАНЯЮТСЯ В PAYLOAD =====

    const blocks =
      result.answer.type === 'product_agent'
        ? [
            {
              worker: 'product_search' as const,

              data: {
                message: result.answer.message,

                groups: result.answer.groups,

                consultation: result.answer.consultation,
              },
            },
          ]
        : result.answer.blocks;

    // ===== END CHANGE: CONSULTATION ARTIFACTS СОХРАНЯЮТСЯ В PAYLOAD =====

    const assistantMessage = await this.chatService.createMessage({
      chatId,

      content: result.answer.message,

      role: ConversationMessageRole.ASSISTANT,

      payload: {
        blocks,
      } as Prisma.InputJsonValue,
    });

    this.server.to(`chat:${chatId}`).emit('chat:new_message', assistantMessage);
  }

  private acquireAssistantSlot(chatId: string) {
    if (
      this.activeAssistantChats.has(chatId) ||
      this.supportAgentService.isThreadActive(chatId)
    ) {
      throw new WsException({
        status: 'conflict',

        message: 'Ассистент уже обрабатывает предыдущий запрос.',
      });
    }

    this.activeAssistantChats.add(chatId);
  }

  private releaseAssistantSlot(chatId: string) {
    this.activeAssistantChats.delete(chatId);
  }

  private emitAssistantError(
    chatId: string,
    error: unknown,
    allowManualRetry: boolean,
  ) {
    const retryable = allowManualRetry && isRetryableAssistantError(error);

    this.server.to(`chat:${chatId}`).emit('chat:error', {
      code: 'ASSISTANT_UNAVAILABLE',

      retryable,

      message: retryable
        ? 'Не удалось получить ответ. Попробуйте ещё раз.'
        : 'Сервис временно недоступен. Попробуйте позже.',
    });
  }

  private emitAssistantEvent(chatId: string, event: SupportAgentStreamEvent) {
    if (event.type === 'assistant_status') {
      this.server.to(`chat:${chatId}`).emit('chat:assistant_status', {
        chatId,

        status: event.status,
      });

      return;
    }

    this.server.to(`chat:${chatId}`).emit('chat:assistant_delta', {
      chatId,

      delta: event.delta,
    });
  }

  private emitAssistantIdle(chatId: string) {
    this.server.to(`chat:${chatId}`).emit('chat:assistant_status', {
      chatId,

      status: 'IDLE',
    });
  }
}
