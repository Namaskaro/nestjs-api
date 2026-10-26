import 'dotenv/config';

import OpenAI from 'openai';

async function main(): Promise<void> {
  const apiKey = process.env.POLZA_API_KEY;

  if (!apiKey) {
    throw new Error('POLZA_API_KEY отсутствует в .env');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.POLZA_BASE_URL ?? 'https://polza.ai/api/v1',
    maxRetries: 0,
  });

  const models = [
    {
      role: 'FAST',
      id: process.env.POLZA_FAST_MODEL ?? 'qwen/qwen3.8-flash',
    },
    {
      role: 'STANDARD',
      id: process.env.POLZA_STANDARD_MODEL ?? 'qwen/qwen3.8-max',
    },
  ];

  for (const model of models) {
    console.log(`\nПроверяем ${model.role}: ${model.id}`);

    try {
      const result = await client.chat.completions.create({
        model: model.id,
        messages: [
          {
            role: 'user',
            content: 'Ответь одним предложением: что такое LangGraph?',
          },
        ],
      });

      const message = result.choices[0]?.message;

      console.log('Ответ:', message?.content);
      console.log('Usage:', result.usage);
      console.log('Finish reason:', result.choices[0]?.finish_reason);
    } catch (error) {
      console.error(`Ошибка ${model.role}:`, error);
    }
  }
}

main().catch(console.error);
