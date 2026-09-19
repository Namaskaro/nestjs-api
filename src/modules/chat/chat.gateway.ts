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

import { SubmitConsultationFeedbackDto } from './dto/submit-consultation-feedback.dto';

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

      await this.runAssistant(dto.chatId, userMessage.content, userMessage.id);
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

      await this.runAssistant(dto.chatId, lastMessage.content, lastMessage.id);
    } finally {
      this.releaseAssistantSlot(dto.chatId);
    }
  }

  @SubscribeMessage('chat:consultation_feedback')
  async submitConsultationFeedback(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: SubmitConsultationFeedbackDto,

    @Ack()
    ack: (payload: unknown) => void,
  ) {
    await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    this.acquireAssistantSlot(dto.chatId);

    try {
      const feedback =
        await this.supportAgentService.submitConsultationFeedback(
          dto.chatId,
          dto.sessionId,
          dto.helpful,
        );

      const assistantMessage =
        await this.chatService.updateConsultationFeedbackMessage({
          chatId: dto.chatId,

          sessionId: feedback.sessionId,

          helpful: feedback.helpful,

          submittedAt: feedback.submittedAt,
        });

      this.server
        .to(`chat:${dto.chatId}`)
        .emit('chat:message_updated', assistantMessage);

      ack({
        sessionId: feedback.sessionId,

        helpful: feedback.helpful,

        submittedAt: feedback.submittedAt,

        messageId: assistantMessage.id,
      });
    } catch (error) {
      if (error instanceof WsException) {
        throw error;
      }

      if (error instanceof Error && error.message.startsWith('ProductAgent:')) {
        throw new WsException({
          status: 'bad_request',

          message: error.message.replace(/^ProductAgent:\s*/u, ''),
        });
      }

      throw error;
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

      this.emitAssistantError(chatId, error, true);
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

    const blocks =
      result.answer.type === 'product_agent'
        ? [
            {
              worker: 'product_search' as const,

              data: {
                message: result.answer.message,

                groups: result.answer.groups,

                consultation: result.answer.consultation,

                consultationCompletion: result.answer.consultationCompletion,
              },
            },
          ]
        : result.answer.blocks;

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

  private emitAssistantEvent(
    chatId: string,

    event: SupportAgentStreamEvent,
  ) {
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
