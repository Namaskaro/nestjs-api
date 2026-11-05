import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  ChatHandoffService,
  type HandoffTransition,
} from './chat-handoff.service';

type AssignmentListener = (result: HandoffTransition) => void | Promise<void>;

@Injectable()
export class ChatHandoffQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatHandoffQueueService.name);

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private assignmentListener: AssignmentListener | null = null;

  constructor(private readonly handoffService: ChatHandoffService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.flush();
    }, 5000);

    void this.flush();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /*
   * Gateway зарегистрирует обработчик,
   * который уведомляет участников чата
   * после успешного назначения.
   */
  setAssignmentListener(listener: AssignmentListener) {
    this.assignmentListener = listener;
  }

  async flush(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const caseIds = await this.handoffService.getWaitingCaseIds(25);

      for (const caseId of caseIds) {
        try {
          const result = await this.handoffService.assignWaiting(caseId);

          if (!result) {
            continue;
          }

          if (this.assignmentListener) {
            try {
              await this.assignmentListener(result);
            } catch (error) {
              this.logger.error(
                `Не удалось отправить уведомление по обращению ${caseId}`,
                error instanceof Error ? error.stack : String(error),
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Не удалось обработать обращение ${caseId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Ошибка обработки очереди операторов',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
