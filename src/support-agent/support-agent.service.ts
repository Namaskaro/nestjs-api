import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { INTERRUPT, isInterrupted } from '@langchain/langgraph';

import {
  ChatMode,
  SupportCaseKind,
  SupportCaseStatus,
} from '@/prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { SupportAgentGraph } from './graph/support-agent.graph';

import type { AssistantStatus } from './schemas/support-agent-status.schema';

import type { SupportAgentContext } from './context/support-agent-context.schema';

import type { ConsultationFeedbackReceipt } from '../product-consultation/application/session/consultation-lifecycle.schema';

type SupportAgentGraphResult = Awaited<ReturnType<SupportAgentGraph['invoke']>>;

type SupportAgentAnswer = NonNullable<SupportAgentGraphResult['answer']>;

type SupportAgentHandoff = SupportAgentGraphResult['handoff'];

export type SupportAgentAssistantStatus = AssistantStatus;

export type SupportAgentStreamEvent =
  | {
      type: 'assistant_status';
      status: SupportAgentAssistantStatus;
    }
  | {
      type: 'assistant_delta';
      delta: string;
    };

export type SupportAgentRunResult =
  | {
      kind: 'answer';
      answer: SupportAgentAnswer;
      handoff: SupportAgentHandoff;
    }
  | {
      kind: 'interrupt';
      interrupt: unknown;
    };

type EventHandler = (event: SupportAgentStreamEvent) => void | Promise<void>;

export class SupportAgentRunInProgressError extends Error {
  readonly code = 'SUPPORT_AGENT_RUN_IN_PROGRESS';

  constructor(threadId: string) {
    super(`SupportAgent run уже выполняется для threadId=${threadId}`);

    this.name = 'SupportAgentRunInProgressError';
  }
}

function statusForProductAction(
  action: string,
): SupportAgentAssistantStatus | null {
  switch (action) {
    case 'SEARCH':
    case 'REFINE':
      return 'SEARCHING_PRODUCTS';

    case 'COMPARE':
      return 'COMPARING_PRODUCTS';

    case 'RECOMMEND':
      return 'PREPARING_RECOMMENDATION';

    default:
      return null;
  }
}

@Injectable()
export class SupportAgentService {
  private readonly activeThreadIds = new Set<string>();

  constructor(
    private readonly supportAgentGraph: SupportAgentGraph,
    private readonly prismaService: PrismaService,
  ) {}

  isThreadActive(threadId: string): boolean {
    return this.activeThreadIds.has(threadId);
  }

  hasPendingInterrupt(threadId: string): Promise<boolean> {
    return this.supportAgentGraph.hasPendingInterrupt(threadId);
  }

  async run(
    query: string,
    threadId: string,
    context: SupportAgentContext,
    onEvent?: EventHandler,
    messageId?: string,
  ): Promise<SupportAgentRunResult> {
    return this.withThreadLock(threadId, async () => {
      /*
       * Перед новым обращением сверяем
       * состояние чата с PostgreSQL.
       *
       * Если предыдущее операторское обращение
       * завершилось, но checkpoint не обновился,
       * восстанавливаем его.
       */
      await this.reconcileBeforeAssistantRun(threadId, context.userId);

      const result = await this.supportAgentGraph.invoke(
        query,
        threadId,
        context,
        this.createCustomEventHandler(onEvent),
        messageId,
      );

      return this.toRunResult(result);
    });
  }

  async resume(
    value: Parameters<SupportAgentGraph['resume']>[0],
    threadId: string,
    context: SupportAgentContext,
    onEvent?: EventHandler,
  ): Promise<SupportAgentRunResult> {
    return this.withThreadLock(threadId, async () => {
      /*
       * Сначала восстанавливаем состояние.
       * Это особенно важно после завершения
       * операторского обращения.
       */
      await this.reconcileBeforeAssistantRun(threadId, context.userId);

      /*
       * После Handoff старое прерывание
       * больше нельзя возобновлять.
       */
      const hasPendingInterrupt =
        await this.supportAgentGraph.hasPendingInterrupt(threadId);

      if (!hasPendingInterrupt) {
        throw new ConflictException(
          'Нет ожидающего AI-прерывания для продолжения.',
        );
      }

      const result = await this.supportAgentGraph.resume(
        value,
        threadId,
        context,
        this.createCustomEventHandler(onEvent),
      );

      return this.toRunResult(result);
    });
  }

  async submitConsultationFeedback(
    threadId: string,
    sessionId: string,
    helpful: boolean,
  ): Promise<ConsultationFeedbackReceipt> {
    return this.withThreadLock(threadId, () =>
      this.supportAgentGraph.submitConsultationFeedback(
        threadId,
        sessionId,
        helpful,
      ),
    );
  }

  /**
   * Вызывается Gateway после подтверждённого
   * изменения статуса операторского обращения.
   */
  async synchronizeOperatorHandoff(
    threadId: string,
    caseId: string,
    status: SupportCaseStatus,
  ): Promise<void> {
    return this.withThreadLock(threadId, () =>
      this.supportAgentGraph.synchronizeOperatorHandoff(
        threadId,
        caseId,
        status,
      ),
    );
  }

  streamEvents(query: string, threadId: string, context: SupportAgentContext) {
    return this.supportAgentGraph.streamEvents(query, threadId, context);
  }

  /**
   * Восстанавливает LangGraph по актуальному
   * состоянию PostgreSQL.
   *
   * Не создаёт новых SupportCase.
   * Не назначает операторов.
   * Не изменяет состояние заказов.
   */
  private async reconcileBeforeAssistantRun(
    threadId: string,
    userId: string,
  ): Promise<void> {
    const chat = await this.prismaService.chat.findUnique({
      where: {
        id: threadId,
      },
      select: {
        id: true,
        userId: true,
        mode: true,
      },
    });

    /*
     * Отдельные отладочные вызовы графа могут
     * выполняться без записи Chat.
     *
     * В таком случае операторского состояния
     * для согласования пока нет.
     */
    if (!chat) {
      return;
    }

    if (chat.userId !== userId) {
      throw new ForbiddenException('AI-запрос не принадлежит владельцу чата.');
    }

    /*
     * PostgreSQL определяет, кто сейчас
     * управляет разговором.
     */
    if (chat.mode !== ChatMode.BOT) {
      throw new ConflictException(
        'Состояние чата изменилось во время обработки запроса.',
      );
    }

    /*
     * Берём последнее именно операторское
     * обращение.
     *
     * Обычные SupportCase, созданные Order Agent,
     * в этом механизме не участвуют.
     */
    const latestHandoff = await this.prismaService.supportCase.findFirst({
      where: {
        chatId: threadId,
        kind: SupportCaseKind.HANDOFF,
      },

      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],

      select: {
        id: true,
        status: true,
      },
    });

    if (!latestHandoff) {
      return;
    }

    const closed =
      latestHandoff.status === SupportCaseStatus.RESOLVED ||
      latestHandoff.status === SupportCaseStatus.CANCELLED;

    /*
     * Если чат уже BOT, но обращение всё ещё
     * активно, это противоречивое состояние.
     *
     * Не запускаем AI поверх оператора.
     */
    if (!closed) {
      throw new ConflictException('Операторское обращение ещё не завершено.');
    }

    /*
     * Если checkpoint уже содержит событие
     * завершения, метод ничего не изменит.
     *
     * Если предыдущая попытка синхронизации
     * упала, событие будет восстановлено.
     *
     * При ошибке повторного восстановления
     * не запускаем AI на старом checkpoint.
     */
    await this.supportAgentGraph.synchronizeOperatorHandoff(
      threadId,
      latestHandoff.id,
      latestHandoff.status,
    );
  }

  private async withThreadLock<T>(
    threadId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.activeThreadIds.has(threadId)) {
      throw new SupportAgentRunInProgressError(threadId);
    }

    this.activeThreadIds.add(threadId);

    try {
      return await operation();
    } finally {
      this.activeThreadIds.delete(threadId);
    }
  }

  private createCustomEventHandler(onEvent?: EventHandler) {
    if (!onEvent) {
      return undefined;
    }

    return async (eventName: string, payload: unknown) => {
      if (eventName === 'assistant_status') {
        const eventPayload = payload as {
          status: SupportAgentAssistantStatus;
        };

        await onEvent({
          type: 'assistant_status',
          status: eventPayload.status,
        });

        return;
      }

      if (eventName === 'product_action_started') {
        const eventPayload = payload as {
          action?: string;
        };

        const status = statusForProductAction(eventPayload.action ?? '');

        if (status) {
          await onEvent({
            type: 'assistant_status',
            status,
          });
        }

        return;
      }

      if (eventName === 'assistant_delta') {
        const eventPayload = payload as {
          delta: string;
        };

        await onEvent({
          type: 'assistant_delta',
          delta: eventPayload.delta,
        });
      }
    };
  }

  private toRunResult(result: SupportAgentGraphResult): SupportAgentRunResult {
    if (isInterrupted(result)) {
      const interrupt = result[INTERRUPT][0];

      if (!interrupt) {
        throw new Error(
          'SupportAgentService: граф остановлен, но interrupt отсутствует',
        );
      }

      return {
        kind: 'interrupt',
        interrupt: interrupt.value,
      };
    }

    if (!result.answer) {
      throw new Error('SupportAgentService: агент не вернул финальный answer');
    }

    return {
      kind: 'answer',
      answer: result.answer,
      handoff: result.handoff,
    };
  }
}
