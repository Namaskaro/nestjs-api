import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { HumanMessage } from '@langchain/core/messages';
import { SupportAgentGraph } from '../graph/support-agent.graph';
import { AppModule } from '@/src/core/app.module';

type TestCase = {
  name: string;
  query: string;
};

const testCases: TestCase[] = [
  {
    name: 'Один intent — поиск товара',
    query: 'Подбери чёрные мужские кроссовки до 15 000 рублей',
  },
  {
    name: 'Несколько intent',
    query:
      'Подбери чёрные кроссовки и скажи, можно ли вернуть товар через неделю',
  },
  {
    name: 'Clarification — тема неизвестна',
    query: 'Мне нужна помощь',
  },
  {
    name: 'Clarification — тема известна',
    query: 'У меня вопрос по доставке',
  },
  {
    name: 'Неподдерживаемый запрос',
    query: 'Напиши функцию сортировки массива на JavaScript',
  },
];

async function runTest(
  graph: ReturnType<SupportAgentGraph['getCompiledGraph']>,
  testCase: TestCase,
): Promise<void> {
  console.log('\n');
  console.log('='.repeat(90));
  console.log(`ТЕСТ: ${testCase.name}`);
  console.log(`ЗАПРОС: ${testCase.query}`);
  console.log('='.repeat(90));

  const stream = await graph.stream(
    {
      query: testCase.query,

      // Если messages уже есть в SupportAgentState
      messages: [new HumanMessage(testCase.query)],
    },
    {
      configurable: {
        thread_id: `debug-${randomUUID()}`,
      },

      /**
       * Показывает только изменения state,
       * которые вернула конкретная нода.
       */
      streamMode: 'updates',

      /**
       * Останавливаем выполнение после конечной
       * для нашего теста ноды.
       *
       * Воркеры после orchestrator не запустятся.
       */
      interruptAfter: ['orchestrator', 'clarification', 'reject'],
    },
  );

  for await (const update of stream) {
    console.dir(update, {
      depth: null,
      colors: true,
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const supportAgentGraph = app.get(SupportAgentGraph);
    const graph = supportAgentGraph.getCompiledGraph();

    for (const testCase of testCases) {
      try {
        await runTest(graph, testCase);
      } catch (error) {
        console.error(`\nОшибка в тесте "${testCase.name}":`);
        console.error(error);
      }
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('Не удалось запустить debug-скрипт:');
  console.error(error);

  process.exitCode = 1;
});
