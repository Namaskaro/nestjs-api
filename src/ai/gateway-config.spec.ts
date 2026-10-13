import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { AiService } from './ai.service';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((options) => ({ options })),
}));
const base = {
  CHAT_MODE: 'gateway',
  EMBEDDING_PROVIDER: 'yandex',
  LITELLM_BASE_URL: 'http://localhost:4000/v1',
  LITELLM_API_KEY: 'offline-gateway',
};
function service(extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { ...base, ...extra };
  return new AiService({ get: (key: string) => values[key] } as ConfigService);
}
describe('gateway mode configuration and isolation', () => {
  beforeEach(() => jest.clearAllMocks());
  it('initializes lazily without upstream chat or embedding credentials', () => {
    const ai = service();
    expect(ChatOpenAI).not.toHaveBeenCalled();
    for (const role of ['FAST', 'STANDARD'] as const) {
      const model = ai.getChatModel(role);
      expect(ai.getChatModel(role)).toBe(model);
    }
    expect(ChatOpenAI).toHaveBeenCalledTimes(2);
    const options = jest
      .mocked(ChatOpenAI)
      .mock.calls.map(([config]) => config);
    expect(options.map((config) => config.model)).toEqual([
      'support-fast',
      'support-standard',
    ]);
    for (const config of options) {
      expect(config).toMatchObject({
        apiKey: 'offline-gateway',
        useResponsesApi: true,
        zdrEnabled: true,
        maxRetries: 0,
        timeout: 70000,
        configuration: {
          baseURL: base.LITELLM_BASE_URL,
          fetch: expect.any(Function),
        },
        metadata: { provider: 'litellm', chatMode: 'gateway' },
      });
      expect(config).not.toHaveProperty('temperature');
      expect(config.modelKwargs).not.toHaveProperty('reasoning');
    }
  });
  it('ignores direct-provider settings in gateway mode', () => {
    service({
      CHAT_PROVIDER: 'unsupported',
      OPENAI_API_KEY: 'unused',
      YANDEX_API_URL: 'unused',
    }).getChatModel('FAST');
    expect(jest.mocked(ChatOpenAI).mock.calls[0][0].apiKey).toBe(
      'offline-gateway',
    );
  });
  it.each(['LITELLM_BASE_URL', 'LITELLM_API_KEY'])(
    'validates missing %s only on first use',
    (key) => {
      const ai = service({ [key]: '' });
      expect(() => ai.getChatModel('FAST')).toThrow(key);
      expect(ChatOpenAI).not.toHaveBeenCalled();
    },
  );
  it.each([
    'https://proxy.invalid',
    'https://user:pass@proxy.invalid/v1',
    'http://localhost:4000/v1?secret=bad',
    'ftp://localhost/v1',
  ])('rejects an invalid base URL %s', (url) => {
    expect(() =>
      service({ LITELLM_BASE_URL: url }).getChatModel('STANDARD'),
    ).toThrow('LITELLM_BASE_URL');
  });
  it('keeps STRONG reserved', () =>
    expect(() => service().getChatModel('STRONG')).toThrow('reserved'));
  it('requires the independent embedding selector', () =>
    expect(() => service({ EMBEDDING_PROVIDER: undefined })).toThrow(
      'EMBEDDING_PROVIDER',
    ));
  it('rejects unknown modes', () =>
    expect(() => service({ CHAT_MODE: 'auto' })).toThrow('CHAT_MODE'));
});
