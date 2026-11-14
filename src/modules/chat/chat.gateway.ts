import { ConsultationMemoryService } from '@/src/consultation-memory/consultation-memory.service';
import type { ConsultationMemoryAdmission, ConsultationMemoryBasis, ConsultationMemoryCandidate } from '@/src/consultation-memory/consultation-memory.types';
import {
  consultationActionField, consultationContinuationOfferIdField, getConsultationAction, getConsultationContinuationOfferId,
  type ConsultationInputAction,
} from '@/src/consultation-memory/consultation-memory.types';
import { Optional } from '@nestjs/common';
import {
  ConflictException,
  Logger,
  NotFoundException,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';

import {
  Ack,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';

import { ChatMode, Prisma } from '@/prisma/generated';

import { Server, Socket } from 'socket.io';

import { v4 as uuidv4, v5 as uuidv5, validate as isUuid } from 'uuid';

import {
  SupportAgentService,
  type SupportAgentStreamEvent,
} from '@/src/support-agent/support-agent.service';

import {
  SupportAgentContextSchema,
  type SupportAgentContext,
} from '@/src/support-agent/context/support-agent-context.schema';

import {
  SupportAgentResumeSchema,
  type SupportAgentResumeValue,
} from '@/src/support-agent/schemas/support-agent-resume.schema';

import {
  clarificationConfig,
  findClarificationQuestion,
} from '@/src/support-agent/config/clarification.config';

import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';

import { ChatService } from './chat.service';

import {
  ChatHandoffService,
  type HandoffTransition,
} from './chat-handoff.service';

import { ChatHandoffQueueService } from './chat-handoff-queue.service';

import { ConsultationResumeDecisionDto } from './dto/consultation-resume-decision.dto';
import { JoinChatDto } from './dto/join-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SubmitConsultationFeedbackDto } from './dto/submit-consultation-feedback.dto';

const HANDOFF_REQUEST_NAMESPACE = '57b68529-6b45-4dd1-9daa-af3ab633f933';

function isRetryableAssistantError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const langGraphCode = (
    error as Error & {
      lc_error_code?: string;
    }
  ).lc_error_code;

  if (langGraphCode) {
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

  return [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'EAI_AGAIN',
  ].includes(code ?? '');
}

function isStaleAssistantResult(error: unknown): boolean {
  if (!(error instanceof ConflictException)) {
    return false;
  }

  const message = error.message;

  return (
    message.includes('Результат AI устарел') ||
    message.includes('Состояние чата изменилось во время обработки')
  );
}

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resumeValueFromMessagePayload(
  payload: Prisma.JsonValue | null,
): SupportAgentResumeValue | null {
  if (!isJsonObject(payload)) {
    return null;
  }

  const parsed = SupportAgentResumeSchema.safeParse(
    payload.clarificationResume,
  );

  return parsed.success ? parsed.data : null;
}

function resumeDisplayText(value: SupportAgentResumeValue): string {
  if (value.kind === 'topic_selected') {
    return clarificationConfig[value.topic].label;
  }

  if (value.kind === 'custom_question') {
    return value.text;
  }

  if (value.kind === 'question_selected') {
    const configured = findClarificationQuestion(value.questionId);

    if (configured) {
      return configured.question.label;
    }

    if (value.questionId === 'order_cancel_decline') {
      return 'Нет';
    }

    if (value.questionId.startsWith('order_cancel_confirm:')) {
      return 'Да, отменить';
    }

    return value.questionId;
  }

  return value.decision === 'accept'
    ? 'Связаться с оператором'
    : 'Продолжить без оператора';
}

function publicChatMessage<T>(message: T) {
  if (!message || typeof message !== 'object') return message;
  const { consultationInputSeq, clientMessageId, assistantSourceMessageId, expectsEpisodeProjection, alreadyAccepted, ...view } =
    message as Record<string, unknown>;
  if (getConsultationContinuationOfferId(view.payload) || getConsultationAction(view.payload)) {
    const { [consultationContinuationOfferIdField]: internalOfferId, [consultationActionField]: internalAction, ...payload } =
      view.payload as Record<string, unknown>;
    view.payload = Object.keys(payload).length ? payload : null;
  }
  return view;
}

function publicChat<T>(chat: T) {
  if (!chat || typeof chat !== 'object') return chat;
  const { consultationInputSeq, consultationAttemptId, consultationSourceMessageId,
    consultationNextInputSeq, consultationNextHandoffVersion, ...view } =
    chat as Record<string, unknown>;
  if (Array.isArray(view.messages)) view.messages = view.messages.map(publicChatMessage);
  return view;
}

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL,
    credentials: true,
  },
})
export class ChatGateway implements OnModuleInit {
  private readonly logger = new Logger(ChatGateway.name);

  private readonly activeAssistantChats = new Set<string>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly supportAgentService: SupportAgentService,
    private readonly handoffService: ChatHandoffService,
    private readonly handoffQueue: ChatHandoffQueueService,
    @Optional() private readonly consultationMemory?: ConsultationMemoryService,
  ) {}

  onModuleInit() {
    this.handoffQueue.setAssignmentListener(async (transition) => {
      await this.publishHandoffTransition(transition);
    });
  }

  @SubscribeMessage('chat:start')
  async chatStart(
    @ConnectedSocket()
    socket: Socket,
  ) {
    const chat = await this.chatService.startChat(socket.data.user);

    await socket.join(`chat:${chat.id}`);

    return publicChat(chat);
  }

  @SubscribeMessage('chat:join')
  async joinChat(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: JoinChatDto,
  ) {
    const chat = await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    const userId = socket.data.user.id;

    if (chat.userId === userId) {
      await socket.join(`chat:${dto.chatId}`);

      const snapshot = await this.handoffService.getCustomerSnapshot(dto.chatId, userId);
      if (dto.requestConsultationOffer !== true || !this.consultationMemory?.enabled ||
          socket.data.user.role !== 'Client') return snapshot;

      let consultationState: Awaited<ReturnType<ConsultationMemoryService['getResumeState']>> =
        { consultationOffer: null, consultationIntent: null };
      try {
        if (snapshot.mode === ChatMode.BOT && !this.activeAssistantChats.has(dto.chatId) &&
            !this.supportAgentService.isThreadActive(dto.chatId) &&
            !await this.supportAgentService.hasPendingInterrupt(dto.chatId)) {
          consultationState = await this.consultationMemory.getResumeState(dto.chatId, userId);
        }
      } catch {
        this.logger.warn('Consultation resume offer unavailable');
      }
      return { ...snapshot, ...consultationState };
    }

    /*
     * Оператор НЕ присоединяется к комнате
     * покупателя.
     *
     * Он получает уведомления через личную
     * авторизованную комнату.
     */
    await this.handoffService.getOperatorInbox(userId);

    await socket.join(`operator:${userId}`);

    return {
      chatId: dto.chatId,
      mode: chat.mode,
    };
  }

  @SubscribeMessage('chat:consultation_resume_decision')
  async decideConsultationResume(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: ConsultationResumeDecisionDto,
  ) {
    if (!isUuid(dto.offerId) || !['continue', 'later', 'start_new'].includes(dto.decision)) {
      throw new WsException({ status: 'bad_request', message: 'Некорректное решение о продолжении подбора.' });
    }
    const userId = socket.data.user.id;
    const snapshot = await this.handoffService.getCustomerSnapshot(dto.chatId, userId);
    if (!this.consultationMemory?.enabled || socket.data.user.role !== 'Client' ||
        snapshot.mode !== ChatMode.BOT || this.activeAssistantChats.has(dto.chatId) ||
        this.supportAgentService.isThreadActive(dto.chatId) ||
        await this.supportAgentService.hasPendingInterrupt(dto.chatId)) {
      throw new WsException({ status: 'conflict', message: 'Предложение больше не актуально.' });
    }
    try {
      return await this.consultationMemory.decideResumeOffer(dto.chatId, userId, dto.offerId, dto.decision);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw new WsException({ status: 'conflict', message: error.message });
      }
      throw error;
    }
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
    if (dto.consultationAction !== undefined &&
        (dto.consultationAction !== 'resume_unchanged' || !dto.continuationOfferId || !dto.clientMessageId)) {
      throw new WsException({ status: 'bad_request', message: 'Некорректная команда продолжения подбора.' });
    }
    if (dto.continuationOfferId !== undefined && !isUuid(dto.continuationOfferId)) {
      throw new WsException({ status: 'bad_request', message: 'Некорректное предложение о продолжении подбора.' });
    }
    const chat = await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    const userId = socket.data.user.id;

    const expectsAssistant =
      chat.userId === userId && chat.mode === ChatMode.BOT;

    if (expectsAssistant) {
      this.acquireAssistantSlot(dto.chatId);
    }

    try {
      const saved = await this.chatService.createParticipantMessage({
        chatId: dto.chatId,
        userId,
        content: dto.consultationAction === 'resume_unchanged' ? 'Продолжить с прежними условиями' : dto.content,
        ...(dto.consultationAction ? { consultationAction: dto.consultationAction } : {}),
        ...(dto.continuationOfferId ? {
          continuationOfferId: dto.continuationOfferId,
          continuationAllowed: Boolean(this.consultationMemory?.enabled &&
            !await this.supportAgentService.hasPendingInterrupt(dto.chatId)),
        } : {}),
        ...(dto.clientMessageId ? { clientMessageId: dto.clientMessageId } : {}),
        ...(this.consultationMemory?.enabled && socket.data.user.role === 'Client' ? { trackConsultation: true } : {}),
      });

      if (saved.duplicate) {
        ack(publicChatMessage(saved.message));
        if (saved.previousReply) socket.emit('chat:new_message', publicChatMessage(saved.previousReply));
        return;
      }

      await this.publishChatMessage(
        dto.chatId,
        saved.message,
        saved.operatorUserId,
      );

      ack(publicChatMessage(saved.message));

      if (!saved.shouldRunAssistant) {
        return;
      }

      const context = this.createSupportAgentContext(socket);

      await this.runAssistant(
        dto.chatId,
        saved.message.content,
        saved.message.id,
        context,
        saved.handoffVersion,
        saved.admission,
        Boolean(dto.clientMessageId),
        Boolean(dto.continuationOfferId),
        getConsultationAction(saved.message.payload),
      );
    } finally {
      if (expectsAssistant) {
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
    const snapshot = await this.handoffService.getCustomerSnapshot(
      dto.chatId,
      socket.data.user.id,
    );

    if (snapshot.mode !== ChatMode.BOT) {
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
        lastMessage.role !== 'USER'
      ) {
        throw new WsException({
          status: 'bad_request',
          message: 'Нет сообщения, для которого можно повторить ответ.',
        });
      }

      ack();

      const context = this.createSupportAgentContext(socket);

      const clarificationResume = resumeValueFromMessagePayload(
        lastMessage.payload,
      );

      if (clarificationResume) {
        await this.runAssistantResume(
          dto.chatId,
          clarificationResume,
          context,
          lastMessage.id,
          snapshot.handoffVersion,
          lastMessage.consultationInputSeq != null,
        );

        return;
      }

      await this.runAssistant(
        dto.chatId,
        lastMessage.content,
        lastMessage.id,
        context,
        snapshot.handoffVersion,
        this.consultationMemory?.enabled && socket.data.user.role === 'Client'
          ? await this.chatService.claimConsultationRetry(dto.chatId, socket.data.user.id, lastMessage.id, snapshot.handoffVersion)
          : null,
        Boolean(lastMessage.clientMessageId || (this.consultationMemory?.enabled && socket.data.user.role === 'Client')),
        Boolean(getConsultationContinuationOfferId(lastMessage.payload)),
        getConsultationAction(lastMessage.payload),
      );
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
    /*
     * Feedback принадлежит покупателю,
     * а не назначенному оператору.
     */
    await this.handoffService.getCustomerSnapshot(
      dto.chatId,
      socket.data.user.id,
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
        .emit('chat:message_updated', publicChatMessage(assistantMessage));

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

  /**
   * Ручной вызов оператора.
   *
   * Использует тот же application-service,
   * что и Handoff через AI.
   */
  @SubscribeMessage('chat:request_operator')
  async requestOperator(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: {
      chatId: string;
      requestId?: string;
    },
  ) {
    const userId = socket.data.user.id;

    const snapshot = await this.handoffService.getCustomerSnapshot(
      dto.chatId,
      userId,
    );

    if (dto.requestId && !isUuid(dto.requestId)) {
      throw new WsException({
        status: 'bad_request',
        message: 'Некорректный requestId.',
      });
    }

    const result = await this.handoffService.request({
      chatId: dto.chatId,
      userId,
      requestId: dto.requestId ?? uuidv4(),
      expectedVersion: snapshot.handoffVersion,
    });

    await this.publishHandoffTransition(result);

    return result;
  }

  /**
   * Покупатель может отменить только ожидание,
   * но не уже начавшийся разговор с оператором.
   */
  @SubscribeMessage('chat:cancel_operator_wait')
  async cancelOperatorWait(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: JoinChatDto,
  ) {
    const transition = await this.handoffService.cancelWaiting(
      dto.chatId,
      socket.data.user.id,
    );

    await this.publishHandoffTransition(transition);

    return transition;
  }

  @SubscribeMessage('chat:clarification_resume')
  async resumeClarification(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: {
      chatId: string;
      value: unknown;
    },

    @Ack()
    ack: (message: unknown) => void,
  ) {
    const resumeValue = SupportAgentResumeSchema.parse(dto.value);

    this.acquireAssistantSlot(dto.chatId);

    try {
      const saved = await this.chatService.createParticipantMessage({
        chatId: dto.chatId,
        userId: socket.data.user.id,
        content: resumeDisplayText(resumeValue),
        requireBot: true,
        ...(this.consultationMemory?.enabled && socket.data.user.role === 'Client' ? { trackConsultation: true } : {}),
        payload: {
          clarificationResume: resumeValue,
        } as Prisma.InputJsonValue,
      });

      await this.publishChatMessage(
        dto.chatId,
        saved.message,
        saved.operatorUserId,
      );

      ack(publicChatMessage(saved.message));

      const context = this.createSupportAgentContext(socket);

      await this.runAssistantResume(
        dto.chatId,
        resumeValue,
        context,
        saved.message.id,
        saved.handoffVersion,
        Boolean(saved.admission),
      );
    } finally {
      this.releaseAssistantSlot(dto.chatId);
    }
  }

  /**
   * Сотрудник получает только собственные
   * назначенные обращения.
   */
  @SubscribeMessage('operator:bootstrap')
  async operatorBootstrap(
    @ConnectedSocket()
    socket: Socket,
  ) {
    const userId = socket.data.user.id;

    const inbox = await this.handoffService.getOperatorInbox(userId);

    await socket.join(`operator:${userId}`);

    return {
      inbox,
    };
  }

  /**
   * Оператор подтверждает готовность
   * принимать новые обращения.
   */
  @SubscribeMessage('operator:ready')
  async operatorReady(
    @ConnectedSocket()
    socket: Socket,
  ) {
    const result = await this.handoffService.setAvailability(
      socket.data.user.id,
      true,
    );

    await socket.join(`operator:${socket.data.user.id}`);

    void this.handoffQueue.flush();

    return result;
  }

  /**
   * Интерфейс оператора должен периодически
   * продлевать доступность.
   */
  @SubscribeMessage('operator:heartbeat')
  async operatorHeartbeat(
    @ConnectedSocket()
    socket: Socket,
  ) {
    return this.handoffService.setAvailability(socket.data.user.id, true);
  }

  @SubscribeMessage('operator:offline')
  async operatorOffline(
    @ConnectedSocket()
    socket: Socket,
  ) {
    return this.handoffService.setAvailability(socket.data.user.id, false);
  }

  /**
   * Получение приватного контекста обращения.
   */
  @SubscribeMessage('operator:case')
  async operatorCase(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: {
      caseId: string;
    },
  ) {
    return this.handoffService.getOperatorCase(dto.caseId, socket.data.user.id);
  }

  /**
   * Завершение операторского обращения.
   */
  @SubscribeMessage('operator:finish')
  async operatorFinish(
    @ConnectedSocket()
    socket: Socket,

    @MessageBody()
    dto: {
      caseId: string;
    },
  ) {
    const result = await this.handoffService.finish(
      dto.caseId,
      socket.data.user.id,
    );

    await this.publishHandoffTransition(result);

    socket.emit('operator:case_finished', {
      caseId: result.caseId,
      chatId: result.chatId,
    });

    void this.handoffQueue.flush();

    return result;
  }

  private async runAssistant(
    chatId: string,
    content: string,
    messageId: string,
    context: SupportAgentContext,
    expectedHandoffVersion: number,
    admission?: ConsultationMemoryAdmission | null,
    deduplicate = false,
    requiresContinuation = false,
    consultationAction?: ConsultationInputAction,
  ) {
    try {
      let basis: ConsultationMemoryBasis | null = null;
      let candidate: ConsultationMemoryCandidate | undefined;
      if (admission && this.consultationMemory) {
        try {
          basis = await this.consultationMemory.getBasis(admission);
        } catch {
          this.logger.warn('Consultation memory basis unavailable');
        }
      }
      if (requiresContinuation && !basis?.continuation) {
        throw new ConflictException('Продолжение подбора недоступно.');
      }

      let memoryUsed = false;
      const bufferedDeltas: SupportAgentStreamEvent[] = [];
      const runtimeContext = basis ? {
        ...context,
        memorySourceMessageId: messageId,
        memoryContinuation: basis.continuation,
        memoryWitnesses: basis.witnesses,
        memoryUsed: () => { memoryUsed = true; },
        memoryCapture: (value: ConsultationMemoryCandidate) => {
          if (value.sourceMessageId === messageId) candidate = value;
        },
      } : context;
      const result = await this.supportAgentService.run(
        content,
        chatId,
        { ...runtimeContext, ...(consultationAction ? { consultationAction } : {}) },
        (event) => {
          if (basis && event.type === 'assistant_delta') bufferedDeltas.push(event);
          else this.emitAssistantEvent(chatId, event);
        },
        messageId,
      );

      await this.handleAgentResult(
        chatId,
        result,
        context.userId,
        messageId,
        expectedHandoffVersion,
        admission || deduplicate ? { basis, candidate, used: memoryUsed, bufferedDeltas } : undefined,
      );
    } catch (error) {
      if (!isStaleAssistantResult(error)) {
        this.logger.error(error);
        this.emitAssistantError(chatId, error);
      }
    } finally {
      this.emitAssistantIdle(chatId);
    }
  }

  private async runAssistantResume(
    chatId: string,
    value: SupportAgentResumeValue,
    context: SupportAgentContext,
    sourceMessageId: string,
    expectedHandoffVersion: number,
    linkReply = false,
  ) {
    try {
      const result = await this.supportAgentService.resume(
        value,
        chatId,
        context,
        (event) => this.emitAssistantEvent(chatId, event),
      );

      await this.handleAgentResult(
        chatId,
        result,
        context.userId,
        sourceMessageId,
        expectedHandoffVersion,
        linkReply ? { basis: null } : undefined,
      );
    } catch (error) {
      if (!isStaleAssistantResult(error)) {
        this.logger.error(error);
        this.emitAssistantError(chatId, error);
      }
    } finally {
      this.emitAssistantIdle(chatId);
    }
  }

  private async handleAgentResult(
    chatId: string,
    result: Awaited<ReturnType<SupportAgentService['run']>>,
    userId: string,
    sourceMessageId: string,
    expectedHandoffVersion: number,
    memory?: {
      basis: ConsultationMemoryBasis | null;
      candidate?: ConsultationMemoryCandidate;
      used?: boolean;
      bufferedDeltas?: SupportAgentStreamEvent[];
    },
  ) {
    if (memory?.used && memory.basis && (result.kind === 'interrupt' || result.handoff)) {
      await this.consultationMemory.verifyReplyCurrent(memory.basis);
    }
    if (result.kind === 'interrupt') {
      const snapshot = await this.handoffService.getCustomerSnapshot(
        chatId,
        userId,
      );

      if (
        snapshot.mode !== ChatMode.BOT ||
        snapshot.handoffVersion !== expectedHandoffVersion
      ) {
        return;
      }

      this.server
        .to(`chat:${chatId}`)
        .emit('chat:clarification', result.interrupt);

      return;
    }

    /*
     * AI подготовил Handoff.
     *
     * Не сохраняем его предварительное сообщение.
     * Сначала регистрируем реальное обращение.
     */
    if (result.handoff) {
      const requestId = uuidv5(
        `ai-handoff:${chatId}:${sourceMessageId}`,
        HANDOFF_REQUEST_NAMESPACE,
      );

      const transition = await this.handoffService.request({
        chatId,
        userId,
        requestId,
        expectedVersion: expectedHandoffVersion,
        sourceMessageId,
        reason: result.handoff.reason,
        context: result.handoff.context,
      });

      await this.publishHandoffTransition(transition);

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
                ...(result.answer.resultGroups
                  ? {
                      resultGroups: result.answer.resultGroups,
                    }
                  : {}),
                consultation: result.answer.consultation,
                consultationCompletion: result.answer.consultationCompletion,
              },
            },
          ]
        : result.answer.blocks;

    const assistantMessage =
      await this.chatService.createAssistantMessageIfCurrent({
        chatId,
        userId,
        expectedHandoffVersion,
        content: result.answer.message,
        ...(memory ? {
          sourceMessageId,
          expectsEpisodeProjection: Boolean(memory.basis && memory.candidate),
          ...(memory.used && memory.basis ? { replyBasis: memory.basis } : {}),
        } : {}),
        payload: {
          blocks,
        } as Prisma.InputJsonValue,
      });

    if (!('alreadyAccepted' in assistantMessage)) {
      for (const delta of memory?.bufferedDeltas ?? []) this.emitAssistantEvent(chatId, delta);
    }
    this.server.to(`chat:${chatId}`).emit('chat:new_message', publicChatMessage(assistantMessage));
    const { basis, candidate } = memory ?? {};
    if (basis && candidate && !('alreadyAccepted' in assistantMessage)) {
      setImmediate(() => {
        void this.consultationMemory.project(basis, assistantMessage.id, candidate)
          .then((status) => {
            if (status === 'STALE') this.logger.warn('Consultation memory projection skipped: stale');
          })
          .catch(() => this.logger.warn('Consultation memory projection failed'));
      });
    }
  }

  private async publishChatMessage(
    chatId: string,
    message: unknown,
    operatorUserId: string | null,
  ) {
    this.server.to(`chat:${chatId}`).emit('chat:new_message', publicChatMessage(message));

    if (operatorUserId) {
      this.server
        .to(`operator:${operatorUserId}`)
        .emit('chat:new_message', publicChatMessage(message));
    }
  }

  private async publishHandoffTransition(transition: HandoffTransition) {
    try {
      await this.supportAgentService.synchronizeOperatorHandoff(
        transition.chatId,
        transition.caseId,
        transition.status,
      );
    } catch (error) {
      this.logger.error(
        `Не удалось согласовать LangGraph после Handoff ${transition.caseId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (!transition.replayed) {
      this.server
        .to(`chat:${transition.chatId}`)
        .emit('chat:new_message', publicChatMessage(transition.message));
    }

    const statusPayload = {
      chatId: transition.chatId,
      caseId: transition.caseId,
      mode: transition.mode,
      operatorId: transition.operatorId,
      caseStatus: transition.status,
      handoffVersion: transition.handoffVersion,
    };

    this.server
      .to(`chat:${transition.chatId}`)
      .emit('chat:status_changed', statusPayload);

    if (transition.operatorId) {
      const operatorUserId = await this.chatService.getOperatorUserId(
        transition.operatorId,
      );

      if (operatorUserId) {
        if (!transition.replayed) {
          this.server
            .to(`operator:${operatorUserId}`)
            .emit('chat:new_message', publicChatMessage(transition.message));
        }

        this.server
          .to(`operator:${operatorUserId}`)
          .emit('operator:case_assigned', statusPayload);
      }
    }
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

  private emitAssistantError(chatId: string, error: unknown) {
    const retryable = isRetryableAssistantError(error);

    this.server.to(`chat:${chatId}`).emit('chat:error', {
      code: 'ASSISTANT_UNAVAILABLE',
      retryable,
      message: retryable
        ? 'Не удалось получить ответ. Попробуйте ещё раз.'
        : 'Не удалось получить ответ.',
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

  private createSupportAgentContext(socket: Socket): SupportAgentContext {
    return SupportAgentContextSchema.parse({
      userId: socket.data.user?.id,
    });
  }
}
