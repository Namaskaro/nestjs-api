import { Injectable } from '@nestjs/common';
import { INTERRUPT, isInterrupted } from '@langchain/langgraph';

import { SupportAgentGraph } from './graph/support-agent.graph';
import type { AssistantStatus } from './schemas/support-agent-status.schema';

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

@Injectable()
export class SupportAgentService {
  private readonly activeThreadIds = new Set<string>();

  constructor(private readonly supportAgentGraph: SupportAgentGraph) {}

  isThreadActive(threadId: string): boolean {
    return this.activeThreadIds.has(threadId);
  }

  async run(
    query: string,
    threadId: string,
    onEvent?: EventHandler,
    messageId?: string,
  ): Promise<SupportAgentRunResult> {
    return this.withThreadLock(threadId, async () => {
      const result = await this.supportAgentGraph.invoke(
        query,
        threadId,
        this.createCustomEventHandler(onEvent),

        // ===== START CHANGE: RETRY ПЕРЕИСПОЛЬЗУЕТ ID DB-СООБЩЕНИЯ =====

        messageId,

        // ===== END CHANGE: RETRY ПЕРЕИСПОЛЬЗУЕТ ID DB-СООБЩЕНИЯ =====
      );

      return this.toRunResult(result);
    });
  }

  async resume(
    value: Parameters<SupportAgentGraph['resume']>[0],

    threadId: string,

    onEvent?: EventHandler,
  ): Promise<SupportAgentRunResult> {
    return this.withThreadLock(threadId, async () => {
      const result = await this.supportAgentGraph.resume(
        value,
        threadId,
        this.createCustomEventHandler(onEvent),
      );

      return this.toRunResult(result);
    });
  }

  streamEvents(query: string, threadId: string) {
    return this.supportAgentGraph.streamEvents(query, threadId);
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
