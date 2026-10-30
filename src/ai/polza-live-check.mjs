/**
 * Диагностика Polza API.
 *
 * Напрямую проверяет скорость и Structured Output моделей Qwen.
 *
 * Без NestJS, LangGraph и LangChain.
 * Без изменений исходного кода проекта.
 *
 * Максимум 6 платных запросов.
 * Таймаут каждого запроса — 20 секунд.
 * Повторных попыток нет.
 *
 * Node.js 20+
 */

const apiKey = process.env.POLZA_API_KEY;

if (!apiKey) {
  console.error('ОШИБКА: переменная POLZA_API_KEY отсутствует.');

  process.exit(1);
}

const endpoint = 'https://polza.ai/api/v1/chat/completions';

const timeoutMs = 20000;

// Простая схема для проверки Structured Output.
const routeSchema = {
  type: 'object',

  properties: {
    agent: {
      type: 'string',

      enum: ['productAgent', 'orderAgent', 'customerHelpAgent'],
    },
  },

  required: ['agent'],

  additionalProperties: false,
};

// Одинаковый запрос для проверки маршрутизации.
const task = 'Подбери мужские кроссовки Nike размера 43';

// Шесть диагностических запросов.
const probes = [
  {
    name: 'A / текущий FAST / короткий текст',
    model: 'qwen/qwen3.8-flash',
    json: false,
  },

  {
    name: 'B / текущий STANDARD / короткий текст',
    model: 'qwen/qwen3.8-max',
    json: false,
    effort: 'low',
  },

  {
    name: 'C / альтернатива FAST / JSON Schema',
    model: 'qwen/qwen3.5-9b',
    json: true,
  },

  {
    name: 'D / альтернатива STANDARD / JSON Schema',
    model: 'qwen/qwen3.6-plus',
    json: true,
  },

  {
    name: 'E / текущий FAST / JSON Schema',
    model: 'qwen/qwen3.8-flash',
    json: true,
  },

  {
    name: 'F / текущий STANDARD / JSON Schema',
    model: 'qwen/qwen3.8-max',
    json: true,
    effort: 'low',
  },
];

const results = [];

console.log('Polza LIVE / максимум 6 запросов / без LangGraph и NestJS');

console.log('Таймаут каждого запроса: 20 секунд.');

console.log('API-ключ не выводится. Реальные запросы могут тарифицироваться.');

for (const p of probes) {
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model: p.model,

    messages: p.json
      ? [
          {
            role: 'system',
            content:
              'Ты маршрутизатор магазина. Выбери агента для запроса. Верни только JSON.',
          },

          {
            role: 'user',
            content: task,
          },
        ]
      : [
          {
            role: 'user',
            content: 'Ответь одним словом: сколько будет 2+2?',
          },
        ],

    temperature: 0,

    max_tokens: 256,

    stream: false,

    ...(p.effort
      ? {
          reasoning_effort: p.effort,
        }
      : {}),

    ...(p.json
      ? {
          response_format: {
            type: 'json_schema',

            json_schema: {
              name: 'route_test',

              strict: false,

              schema: routeSchema,
            },
          },
        }
      : {}),
  };

  const started = performance.now();

  console.log(`\n${p.name} [${p.model}]...`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${apiKey}`,

        'Content-Type': 'application/json',
      },

      body: JSON.stringify(body),

      signal: controller.signal,
    });

    const raw = await response.text();

    const ms = Math.round(performance.now() - started);

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    // Ошибка от API Polza.
    if (!response.ok) {
      const message = String(
        data?.error?.message ?? data?.message ?? raw.slice(0, 180),
      )
        .replaceAll(apiKey, '[REDACTED]')
        .slice(0, 300);

      console.log(`HTTP ${response.status} / ${ms} мс / ${message}`);

      results.push({
        probe: p.name,

        model: p.model,

        ms,

        status: response.status,

        error: message,
      });

      continue;
    }

    // Успешный HTTP-ответ.
    const choice = data?.choices?.[0];

    const output = choice?.message?.content;

    let parsed;

    try {
      parsed = typeof output === 'string' ? JSON.parse(output) : null;
    } catch {
      parsed = null;
    }

    const validJson = p.json ? parsed?.agent === 'productAgent' : null;

    const row = {
      probe: p.name,

      model: p.model,

      ms,

      status: response.status,

      finish_reason: choice?.finish_reason ?? null,

      input_tokens: data?.usage?.prompt_tokens ?? null,

      output_tokens: data?.usage?.completion_tokens ?? null,

      reasoning_tokens:
        data?.usage?.completion_tokens_details?.reasoning_tokens ?? null,

      ...(p.json
        ? {
            valid_router_json: validJson,
          }
        : {
            text: typeof output === 'string' ? output.slice(0, 100) : null,
          }),
    };

    results.push(row);

    console.log(JSON.stringify(row, null, 2));
  } catch (error) {
    const ms = Math.round(performance.now() - started);

    const message = controller.signal.aborted
      ? `CLIENT_TIMEOUT_${timeoutMs}ms`
      : `${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(
          0,
          160,
        )}`;

    console.log(`${message} / ${ms} мс`);

    results.push({
      probe: p.name,

      model: p.model,

      ms,

      status: null,

      error: message,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Итоговый отчёт.
console.log('\n====== КОПИРУЙ СЮДА ТОЛЬКО ЭТОТ ИТОГ ======');

console.log(JSON.stringify(results, null, 2));

console.log('====== КОНЕЦ ИТОГА ======');
