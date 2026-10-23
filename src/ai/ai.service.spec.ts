import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ChatOpenAI } from '@langchain/openai';
import { OpenAI } from 'openai/client.js';

import { AiService, type ChatModelRole } from './ai.service';
import { AiModule } from './ai.module';
import { llmUsageCallback } from './llm-usage';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((options) => ({ options })),
}));

const mockEmbeddingCreate = jest.fn();

jest.mock('openai/client.js', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingCreate },
  })),
}));

// Bootstrap only the AI module; Prisma must never initialize a real client.
jest.mock('../core/prisma/prisma.module', () => ({
  PrismaModule: class PrismaModule {},
}));

const chatConfig = {
  yandex: {
    YANDEX_API_KEY: 'test-yandex-key',
    YANDEX_API_URL: 'https://yandex.invalid/v1',
    YANDEX_LITE_MODEL: 'configured-yandex-fast',
    YANDEX_MODEL: 'configured-yandex-standard',
  },
  openai: {
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_FAST_MODEL: 'configured-openai-fast',
    OPENAI_STANDARD_MODEL: 'configured-openai-standard',
    OPENAI_FAST_TRANSPORT_PROFILE: 'gpt-6-luna',
    OPENAI_STANDARD_TRANSPORT_PROFILE: 'gpt-6.1-sol',
  },
};

const embeddingConfig = {
  yandex: {
    YANDEX_API_KEY: 'test-yandex-key',
    YANDEX_FOLDER_ID: 'test-folder',
    YANDEX_EMBEDDING_QUERY_MODEL: 'configured-query',
    YANDEX_EMBEDDING_DOCUMENT_MODEL: 'configured-document',
    YANDEX_EMBEDDING_DIMENSIONS: 2,
  },
  openai: {
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_EMBEDDING_MODEL: 'configured-embedding',
    OPENAI_EMBEDDING_DIMENSIONS: 2,
  },
};

function createService(values: Record<string, unknown>) {
  // Do not consult process.env or bootstrap any external application services.
  const config = { get: (key: string) => values[key] } as ConfigService;
  return new AiService(config);
}

describe('AiService provider-neutral roles and independent embeddings', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbeddingCreate.mockReset();
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(
        new Error('Network is forbidden in this offline test'),
      );
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it.each(['yandex', 'openai'] as const)(
    'boots AiModule with only %s credentials and no eager provider clients',
    async (provider) => {
      const values: Record<string, unknown> = {
        CHAT_PROVIDER: provider,
        EMBEDDING_PROVIDER: provider,
        ...chatConfig[provider],
      };
      const module = await Test.createTestingModule({ imports: [AiModule] })
        .overrideProvider(ConfigService)
        .useValue({ get: (key: string) => values[key] })
        .compile();
      try {
        await module.init();
        expect(ChatOpenAI).not.toHaveBeenCalled();
        expect(OpenAI).not.toHaveBeenCalled();
        module.get(AiService).getChatModel('FAST');
        module.get(AiService).getChatModel('STANDARD');
        expect(ChatOpenAI).toHaveBeenCalledTimes(2);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        await module.close();
      }
    },
  );

  it.each([
    ['yandex', 'FAST', 'configured-yandex-fast'],
    ['yandex', 'STANDARD', 'configured-yandex-standard'],
    ['openai', 'FAST', 'configured-openai-fast'],
    ['openai', 'STANDARD', 'configured-openai-standard'],
  ] as const)(
    'maps %s / %s to deployment model %s',
    (provider, role, model) => {
      const service = createService({
        CHAT_PROVIDER: provider,
        EMBEDDING_PROVIDER: provider,
        ...chatConfig[provider],
      });

      expect(ChatOpenAI).not.toHaveBeenCalled();
      expect(OpenAI).not.toHaveBeenCalled();

      const selected = service.getChatModel(role);
      expect(service.getChatModel(role)).toBe(selected);
      expect(ChatOpenAI).toHaveBeenCalledTimes(1);
      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          model,
          apiKey: `test-${provider}-key`,
          maxRetries: 0,
          callbacks: [llmUsageCallback],
          tags: expect.arrayContaining([
            `role:${role}`,
            `provider:${provider}`,
            `model:${model}`,
          ]),
          metadata: { role, provider, model },
        }),
      );

      const options = jest.mocked(ChatOpenAI).mock.calls[0][0];
      if (provider === 'yandex') {
        expect(options).toMatchObject({
          configuration: { baseURL: chatConfig.yandex.YANDEX_API_URL },
          useResponsesApi: false,
          temperature: 0,
          streamUsage: false,
        });
      } else {
        expect(options).toMatchObject({
          useResponsesApi: true,
          zdrEnabled: true,
          modelKwargs: {
            reasoning: { effort: role === 'FAST' ? 'none' : 'medium' },
            include: ['reasoning.encrypted_content'],
          },
        });
        if (role === 'STANDARD') {
          expect(options).not.toHaveProperty('temperature');
        } else {
          expect(options.temperature).toBe(0);
        }
        expect(options.configuration).toEqual({ fetch: expect.any(Function) });
        expect(options).not.toHaveProperty('streamUsage');
      }
      expect(OpenAI).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['yandex', 'openai'] as const)(
    'supports both current %s roles without STRONG or other provider credentials',
    (provider) => {
      const service = createService({
        CHAT_PROVIDER: provider,
        EMBEDDING_PROVIDER: provider,
        ...chatConfig[provider],
      });

      expect(service.getChatModel('FAST')).not.toBe(
        service.getChatModel('STANDARD'),
      );
      expect(() => service.getChatModel('STRONG')).toThrow(
        'STRONG is reserved',
      );
      expect(ChatOpenAI).toHaveBeenCalledTimes(2);
      expect(OpenAI).not.toHaveBeenCalled();
    },
  );

  it.each(['yandex', 'openai'] as const)(
    'keeps the %s query/document/batch embedding pair across chat provider changes',
    async (embeddingProvider) => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [1, '2'] }),
      });
      mockEmbeddingCreate.mockImplementation(async ({ input }) => ({
        data: Array.isArray(input)
          ? [
              { index: 1, embedding: [3, 4] },
              { index: 0, embedding: [1, 2] },
            ]
          : [{ index: 0, embedding: [1, 2] }],
      }));

      for (const chatProvider of ['yandex', 'openai'] as const) {
        const service = createService({
          CHAT_PROVIDER: chatProvider,
          EMBEDDING_PROVIDER: embeddingProvider,
          ...chatConfig[chatProvider],
          ...embeddingConfig[embeddingProvider],
        });
        service.getChatModel('FAST');
        service.getChatModel('STANDARD');

        expect(await service.createQueryEmbedding('query')).toEqual([1, 2]);
        expect(await service.createDocumentEmbedding('document')).toEqual([
          1, 2,
        ]);
        expect(await service.createDocumentEmbeddings(['a', 'b'])).toEqual(
          embeddingProvider === 'openai'
            ? [
                [1, 2],
                [3, 4],
              ]
            : [
                [1, 2],
                [1, 2],
              ],
        );
      }

      if (embeddingProvider === 'yandex') {
        expect(OpenAI).not.toHaveBeenCalled();
        expect(mockEmbeddingCreate).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(8);
        const bodies = fetchMock.mock.calls.map(([, init]) =>
          JSON.parse(init.body),
        );
        expect(bodies.slice(0, 4)).toEqual([
          { modelUri: 'configured-query', text: 'query', dim: '2' },
          { modelUri: 'configured-document', text: 'document', dim: '2' },
          { modelUri: 'configured-document', text: 'a', dim: '2' },
          { modelUri: 'configured-document', text: 'b', dim: '2' },
        ]);
        expect(bodies.slice(4)).toEqual(bodies.slice(0, 4));
      } else {
        expect(fetchMock).not.toHaveBeenCalled();
        expect(OpenAI).toHaveBeenCalledTimes(2); // Once per service, reused for all embeddings.
        expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-openai-key' });
        expect(mockEmbeddingCreate).toHaveBeenCalledTimes(6);
        const requests = mockEmbeddingCreate.mock.calls.map(
          ([request]) => request,
        );
        expect(requests.slice(0, 3)).toEqual([
          { model: 'configured-embedding', input: 'query', dimensions: 2 },
          { model: 'configured-embedding', input: 'document', dimensions: 2 },
          { model: 'configured-embedding', input: ['a', 'b'], dimensions: 2 },
        ]);
        expect(requests.slice(3)).toEqual(requests.slice(0, 3));
      }
    },
  );

  it.each(['yandex', 'openai'] as const)(
    'keeps %s chat models across embedding provider changes',
    (chatProvider) => {
      for (const embeddingProvider of ['yandex', 'openai'] as const) {
        const service = createService({
          CHAT_PROVIDER: chatProvider,
          EMBEDDING_PROVIDER: embeddingProvider,
          ...chatConfig[chatProvider],
          ...embeddingConfig[embeddingProvider],
        });
        service.getChatModel('FAST');
        service.getChatModel('STANDARD');
      }
      const options = jest.mocked(ChatOpenAI).mock.calls.map(([input]) => ({
        ...input,
        configuration: { ...input.configuration, fetch: expect.any(Function) },
      }));
      expect(options.slice(0, 2)).toEqual(options.slice(2));
      expect(OpenAI).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['CHAT_PROVIDER', 'EMBEDDING_PROVIDER'])(
    'requires an explicit valid %s instead of falling back to AI_PROVIDER',
    (key) => {
      for (const invalid of [undefined, '', 'unknown']) {
        expect(() =>
          createService({
            CHAT_PROVIDER: 'yandex',
            EMBEDDING_PROVIDER: 'yandex',
            AI_PROVIDER: 'openai',
            [key]: invalid,
          }),
        ).toThrow(
          key === 'CHAT_PROVIDER'
            ? `${key} must be "openai", "yandex", "qwen" or "gigachat"`
            : `${key} must be "openai" or "yandex"`,
        );
      }
      expect(ChatOpenAI).not.toHaveBeenCalled();
      expect(OpenAI).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['yandex', 'FAST', 'YANDEX_LITE_MODEL'],
    ['yandex', 'STANDARD', 'YANDEX_MODEL'],
    ['yandex', 'STANDARD', 'YANDEX_API_KEY'],
    ['yandex', 'STANDARD', 'YANDEX_API_URL'],
    ['openai', 'FAST', 'OPENAI_FAST_MODEL'],
    ['openai', 'STANDARD', 'OPENAI_STANDARD_MODEL'],
    ['openai', 'STANDARD', 'OPENAI_API_KEY'],
  ] as const)(
    'reports missing %s %s configuration: %s',
    (provider, role, key) => {
      for (const invalid of [undefined, '', '   ']) {
        const service = createService({
          CHAT_PROVIDER: provider,
          EMBEDDING_PROVIDER: provider,
          ...chatConfig[provider],
          OPENAI_CHAT_MODEL: 'obsolete-model-must-not-be-a-fallback',
          [key]: invalid,
        });
        expect(() => service.getChatModel(role)).toThrow(
          `${key} must be a non-empty string`,
        );
      }
      expect(ChatOpenAI).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a runtime provider literal instead of silently selecting a role', () => {
    const service = createService({
      CHAT_PROVIDER: 'yandex',
      EMBEDDING_PROVIDER: 'yandex',
    });
    expect(() => service.getChatModel('yandex' as ChatModelRole)).toThrow(
      'unsupported chat role',
    );
    expect(ChatOpenAI).not.toHaveBeenCalled();
  });

  it.each([
    ['yandex', 'YANDEX_API_KEY'],
    ['yandex', 'YANDEX_FOLDER_ID'],
    ['yandex', 'YANDEX_EMBEDDING_QUERY_MODEL'],
    ['openai', 'OPENAI_API_KEY'],
    ['openai', 'OPENAI_EMBEDDING_MODEL'],
  ] as const)(
    'reports missing %s embedding configuration: %s',
    async (provider, key) => {
      const service = createService({
        CHAT_PROVIDER: provider,
        EMBEDDING_PROVIDER: provider,
        ...embeddingConfig[provider],
        [key]: undefined,
      });
      await expect(service.createQueryEmbedding('query')).rejects.toThrow(
        `${key} must be a non-empty string`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockEmbeddingCreate).not.toHaveBeenCalled();
    },
  );

  it.each(['yandex', 'openai'] as const)(
    'rejects invalid %s embedding dimensions offline',
    async (provider) => {
      const key =
        provider === 'yandex'
          ? 'YANDEX_EMBEDDING_DIMENSIONS'
          : 'OPENAI_EMBEDDING_DIMENSIONS';
      const service = createService({
        CHAT_PROVIDER: provider,
        EMBEDDING_PROVIDER: provider,
        ...embeddingConfig[provider],
        [key]: -1,
      });
      await expect(service.createQueryEmbedding('query')).rejects.toThrow(key);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockEmbeddingCreate).not.toHaveBeenCalled();
    },
  );

  it.each(['yandex', 'openai'] as const)(
    'does not create clients for an empty %s embedding batch',
    async (provider) => {
      const service = createService({
        CHAT_PROVIDER: provider,
        EMBEDDING_PROVIDER: provider,
      });
      expect(await service.createDocumentEmbeddings([])).toEqual([]);
      expect(OpenAI).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
