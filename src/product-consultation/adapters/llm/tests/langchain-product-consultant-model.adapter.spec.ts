import { describe, expect, it, jest } from '@jest/globals';

import type { AiService } from '../../../../ai/ai.service';

import type { ProductConsultantModelInput } from '../../../application/consultant/product-consultant-model.port';

import { LangChainProductConsultantModelAdapter } from '../langchain-product-consultant-model.adapter';

function validDecision() {
  return {
    proposal: {
      action: 'CLARIFY',

      taskTransition: 'start_new',

      search: {
        semanticIntent: 'мужские кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'gender',

            operator: 'eq',

            value: 'MAN',

            unit: null,
          },
        ],
      },

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: 'Для чего в основном нужны кроссовки?',
  };
}

function modelInput(): ProductConsultantModelInput {
  return {
    round: 1,

    observation: {
      kind: 'initial',
    },

    context: {
      version: 1,

      currentMessage: 'Нужны мужские кроссовки',

      recentMessages: [],

      task: null,

      searchCapabilities: null,

      results: {
        status: 'idle',

        hasLastConfirmed: false,

        shownProducts: [],
      },

      productFacts: [],

      comparison: null,

      profile: null,

      usage: null,
    },
  };
}

describe('LangChainProductConsultantModelAdapter', () => {
  it('uses a normal chat call and parses JSON without provider structured output', async () => {
    const decision = validDecision();

    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: JSON.stringify(decision),
    }));

    const getChatModel = jest.fn(() => ({
      invoke,
    }));

    const aiService = {
      getChatModel,
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    const result = await adapter.decide(modelInput());

    expect(result).toEqual(decision);

    expect(getChatModel).toHaveBeenCalledTimes(1);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not use provider-side withStructuredOutput', async () => {
    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: JSON.stringify(validDecision()),
    }));

    const withStructuredOutput = jest.fn();

    const aiService = {
      getChatModel: () => ({
        invoke,

        withStructuredOutput,
      }),
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    await adapter.decide(modelInput());

    expect(withStructuredOutput).not.toHaveBeenCalled();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('accepts defensive json markdown fence from provider', async () => {
    const decision = validDecision();

    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: ['```json', JSON.stringify(decision), '```'].join('\n'),
    }));

    const aiService = {
      getChatModel: () => ({
        invoke,
      }),
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    await expect(adapter.decide(modelInput())).resolves.toEqual(decision);
  });

  it('extracts an obvious json object when provider adds surrounding prose', async () => {
    const decision = validDecision();

    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: `Ответ:\n${JSON.stringify(decision)}\nКонец.`,
    }));

    const aiService = {
      getChatModel: () => ({
        invoke,
      }),
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    await expect(adapter.decide(modelInput())).resolves.toEqual(decision);
  });

  it('throws a useful error when provider returns invalid json', async () => {
    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: 'Я думаю, нужно поискать кроссовки.',
    }));

    const aiService = {
      getChatModel: () => ({
        invoke,
      }),
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    await expect(adapter.decide(modelInput())).rejects.toThrow(
      'Product Consultant model returned invalid JSON',
    );
  });

  it('passes round, observation and context to the model', async () => {
    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: JSON.stringify(validDecision()),
    }));

    const aiService = {
      getChatModel: () => ({
        invoke,
      }),
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    await adapter.decide(modelInput());

    const invocation = invoke.mock.calls[0];

    const messages = invocation?.[0] as Array<{
      content?: unknown;
    }>;

    expect(messages).toHaveLength(2);

    const systemText = String(messages[0]?.content ?? '');

    const userText = String(messages[1]?.content ?? '');

    expect(systemText).toContain('Product Consultant интернет-магазина');

    expect(systemText).toContain('ТОЛЬКО один JSON-объект');

    expect(systemText).toContain('ROUND 2');

    expect(userText).toContain('"round": 1');

    expect(userText).toContain('"kind": "initial"');

    expect(userText).toContain('Нужны мужские кроссовки');
  });

  it('forwards AbortSignal to LangChain invoke', async () => {
    const invoke = jest.fn(async (_messages: unknown, _config?: unknown) => ({
      content: JSON.stringify(validDecision()),
    }));

    const aiService = {
      getChatModel: () => ({
        invoke,
      }),
    } as unknown as AiService;

    const adapter = new LangChainProductConsultantModelAdapter(aiService);

    const controller = new AbortController();

    await adapter.decide({
      ...modelInput(),

      signal: controller.signal,
    });

    expect(invoke.mock.calls[0]?.[1]).toEqual({
      signal: controller.signal,
    });
  });
});
