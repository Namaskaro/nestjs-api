import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';

import { ChatMode, ConversationMessageRole, Prisma } from '@/prisma/generated';

import { AppModule } from '@/src/core/app.module';
import { PrismaService } from '@/src/core/prisma/prisma.service';

import {
  buildConsultationCompletionPresentation,
  completeConsultationSession,
  touchConsultationSession,
} from '../agents/product-agent/consultation-session';

import { SupportAgentGraph } from '../graph/support-agent.graph';

import { SupportAgentService } from '../support-agent.service';

import {
  emptyProductContext,
  readProductContext,
} from '../../product-consultation/application/context/product-context.schema';
import { ChatService } from '@/src/modules/chat/chat.service';

const THREAD_ID = 'consultation-feedback-debug';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFeedbackFromPayload(
  payload: unknown,
  sessionId: string,
): {
  helpful: boolean;
  submittedAt: string;
} | null {
  if (!isObject(payload)) {
    return null;
  }

  const blocks = payload.blocks;

  if (!Array.isArray(blocks)) {
    return null;
  }

  for (const block of blocks) {
    if (!isObject(block)) {
      continue;
    }

    const data = block.data;

    if (!isObject(data)) {
      continue;
    }

    const completion = data.consultationCompletion;

    if (!isObject(completion) || completion.sessionId !== sessionId) {
      continue;
    }

    const feedback = completion.feedback;

    if (!isObject(feedback)) {
      return null;
    }

    if (
      typeof feedback.helpful !== 'boolean' ||
      typeof feedback.submittedAt !== 'string'
    ) {
      return null;
    }

    return {
      helpful: feedback.helpful,

      submittedAt: feedback.submittedAt,
    };
  }

  return null;
}

async function run(): Promise<void> {
  console.log('CONSULTATION FEEDBACK INTEGRATION DEBUG');

  console.log('Paid LLM calls: 0');

  console.log('Qdrant searches: 0');

  console.log('Uses Postgres checkpoint: YES');

  console.log('Uses temporary Message row: YES');

  console.log('');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const supportAgentGraph = app.get(SupportAgentGraph);

  const supportAgentService = app.get(SupportAgentService);

  const chatService = app.get(ChatService);

  const prisma = app.get(PrismaService);

  let temporaryChatId: string | null = null;

  const temporaryMessageIds: string[] = [];

  try {
    const context = emptyProductContext();

    touchConsultationSession(
      context,
      ['debug-need'],
      new Date('2026-09-17T12:00:00.000Z'),
    );

    const completed = completeConsultationSession(context, {
      reason: 'USER_DONE',

      now: new Date('2026-09-17T12:01:00.000Z'),
    });

    const sessionId = completed.sessionId;

    const presentation = buildConsultationCompletionPresentation(completed);

    assert(
      presentation.feedback === null,
      'Initial completion presentation должен иметь feedback=null.',
    );

    console.log('✅ Подготовлена COMPLETED consultation session');

    const compiledGraph = supportAgentGraph.getCompiledGraph();

    const config = {
      configurable: {
        thread_id: THREAD_ID,
      },
    };

    await compiledGraph.updateState(
      config,
      {
        productContext: context,
      },
      'productAgent',
    );

    const initialSnapshot = await compiledGraph.getState(config);

    const initialContext = readProductContext(
      initialSnapshot.values.productContext,
    );

    assert(
      initialContext.consultationSession?.sessionId === sessionId,
      'Checkpoint потерял sessionId.',
    );

    assert(
      initialContext.consultationSession?.status === 'COMPLETED',
      'Checkpoint потерял COMPLETED status.',
    );

    assert(
      initialContext.consultationSession?.feedback === null,
      'Initial checkpoint уже содержит feedback.',
    );

    console.log('✅ COMPLETED session сохранена в LangGraph checkpoint');

    const positive = await supportAgentService.submitConsultationFeedback(
      THREAD_ID,
      sessionId,
      true,
    );

    assert(
      positive.helpful === true,
      'Первый feedback должен быть helpful=true.',
    );

    const positiveSnapshot = await compiledGraph.getState(config);

    const positiveContext = readProductContext(
      positiveSnapshot.values.productContext,
    );

    assert(
      positiveContext.consultationSession?.feedback?.helpful === true,
      '👍 не сохранился в checkpoint.',
    );

    assert(
      positiveContext.consultationSession?.feedback?.source === 'BUTTON',
      'Feedback source должен быть BUTTON.',
    );

    console.log('✅ 👍 сохраняется в checkpoint');

    const repeatedPositive =
      await supportAgentService.submitConsultationFeedback(
        THREAD_ID,
        sessionId,
        true,
      );

    assert(
      repeatedPositive.submittedAt === positive.submittedAt,
      'Повторный одинаковый feedback должен быть идемпотентным.',
    );

    console.log('✅ Повторный 👍 идемпотентен');

    let chat = await prisma.chat.findFirst({
      select: {
        id: true,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!chat) {
      const user = await prisma.user.findFirst({
        select: {
          id: true,
        },
      });

      assert(
        user,
        'В БД нет ни одного пользователя для временного debug-чата.',
      );

      chat = await prisma.chat.create({
        data: {
          userId: user.id,

          mode: ChatMode.BOT,
        },

        select: {
          id: true,
        },
      });

      temporaryChatId = chat.id;
    }

    const targetPayload = {
      blocks: [
        {
          worker: 'product_search',

          data: {
            message: 'Debug completed consultation',

            groups: [],

            consultation: null,

            consultationCompletion: presentation,
          },
        },
      ],
    } as Prisma.InputJsonValue;

    const targetMessage = await prisma.message.create({
      data: {
        chatId: chat.id,

        role: ConversationMessageRole.ASSISTANT,

        content: '__consultation_feedback_debug_target__',

        payload: targetPayload,
      },
    });

    temporaryMessageIds.push(targetMessage.id);

    const decoySessionId = randomUUID();

    const decoyMessage = await prisma.message.create({
      data: {
        chatId: chat.id,

        role: ConversationMessageRole.ASSISTANT,

        content: '__consultation_feedback_debug_decoy__',

        payload: {
          blocks: [
            {
              worker: 'product_search',

              data: {
                message: 'Debug decoy',

                groups: [],

                consultation: null,

                consultationCompletion: {
                  ...presentation,

                  sessionId: decoySessionId,
                },
              },
            },
          ],
        } as Prisma.InputJsonValue,
      },
    });

    temporaryMessageIds.push(decoyMessage.id);

    console.log('✅ Созданы временные assistant messages');

    const updatedMessage = await chatService.updateConsultationFeedbackMessage({
      chatId: chat.id,

      sessionId: sessionId,

      helpful: positive.helpful,

      submittedAt: positive.submittedAt,
    });

    assert(
      updatedMessage.id === targetMessage.id,
      'ChatService обновил не то assistant message.',
    );

    const storedTarget = await prisma.message.findUnique({
      where: {
        id: targetMessage.id,
      },

      select: {
        payload: true,
      },
    });

    assert(storedTarget, 'Target message исчез.');

    const storedPositive = readFeedbackFromPayload(
      storedTarget.payload,
      sessionId,
    );

    assert(
      storedPositive?.helpful === true,
      '👍 не сохранился в Message.payload.',
    );

    assert(
      storedPositive.submittedAt === positive.submittedAt,
      'Message.payload получил неверный submittedAt.',
    );

    const storedDecoy = await prisma.message.findUnique({
      where: {
        id: decoyMessage.id,
      },

      select: {
        payload: true,
      },
    });

    assert(storedDecoy, 'Decoy message исчез.');

    assert(
      readFeedbackFromPayload(storedDecoy.payload, decoySessionId) === null,
      'ChatService изменил чужую consultation session.',
    );

    console.log('✅ 👍 сохраняется в правильный Message.payload по sessionId');

    console.log('✅ Соседнее assistant message не изменяется');

    const negative = await supportAgentService.submitConsultationFeedback(
      THREAD_ID,
      sessionId,
      false,
    );

    assert(
      negative.helpful === false,
      'Смена feedback должна вернуть helpful=false.',
    );

    const negativeSnapshot = await compiledGraph.getState(config);

    const negativeContext = readProductContext(
      negativeSnapshot.values.productContext,
    );

    assert(
      negativeContext.consultationSession?.feedback?.helpful === false,
      '👎 не заменил 👍 в checkpoint.',
    );

    await chatService.updateConsultationFeedbackMessage({
      chatId: chat.id,

      sessionId,

      helpful: negative.helpful,

      submittedAt: negative.submittedAt,
    });

    const finalMessage = await prisma.message.findUnique({
      where: {
        id: targetMessage.id,
      },

      select: {
        payload: true,
      },
    });

    assert(finalMessage, 'Target message исчез после 👎.');

    const storedNegative = readFeedbackFromPayload(
      finalMessage.payload,
      sessionId,
    );

    assert(
      storedNegative?.helpful === false,
      '👎 не заменил 👍 в Message.payload.',
    );

    console.log('✅ Пользователь может изменить 👍 на 👎');

    console.log('✅ Checkpoint и Message.payload синхронизированы');

    console.log('');

    console.log('✅ CONSULTATION FEEDBACK INTEGRATION DEBUG PASSED');
  } finally {
    if (temporaryMessageIds.length) {
      await prisma.message.deleteMany({
        where: {
          id: {
            in: temporaryMessageIds,
          },
        },
      });
    }

    if (temporaryChatId) {
      await prisma.chat.delete({
        where: {
          id: temporaryChatId,
        },
      });
    }

    await app.close();
  }
}

run().catch((error) => {
  console.error('');

  console.error('❌ CONSULTATION FEEDBACK INTEGRATION DEBUG FAILED');

  console.error(error);

  process.exitCode = 1;
});
