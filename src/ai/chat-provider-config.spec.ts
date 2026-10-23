import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AiService } from './ai.service';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((options) => ({ options })),
}));
const base = {
  CHAT_FAST_PROVIDER: 'yandex',
  CHAT_FAST_MODEL: 'gpt://offline/fast',
  CHAT_STANDARD_PROVIDER: 'openai',
  CHAT_STANDARD_MODEL: 'gpt-6.1-sol',
  EMBEDDING_PROVIDER: 'yandex',
  OPENAI_API_KEY: 'offline-openai',
  YANDEX_API_KEY: 'offline-yandex',
  YANDEX_API_URL: 'https://yandex.invalid/v1',
};
function service(extra: Record<string, unknown> = {}) {
  const values = { ...base, ...extra };
  return new AiService({ get: (key: string) => values[key] } as ConfigService);
}
describe('direct role configuration', () => {
  beforeEach(() => jest.clearAllMocks());
  it('prefers explicit role settings without accidentally reusing a legacy model', () => {
    const ai = service({
      CHAT_PROVIDER: 'openai',
      OPENAI_FAST_MODEL: 'legacy-fast',
      OPENAI_STANDARD_MODEL: 'legacy-standard',
      YANDEX_LITE_MODEL: 'legacy-yandex',
    });
    ai.getChatModel('FAST');
    ai.getChatModel('STANDARD');
    const options = jest
      .mocked(ChatOpenAI)
      .mock.calls.map(([config]) => config);
    expect(options.map((config) => config.model)).toEqual([
      'gpt://offline/fast',
      'gpt-6.1-sol',
    ]);
    expect(options.map((config) => config.apiKey)).toEqual([
      'offline-yandex',
      'offline-openai',
    ]);
    expect(
      options.every(
        (config) =>
          config.timeout === 60000 &&
          config.maxRetries === 0 &&
          config.disableStreaming === true,
      ),
    ).toBe(true);
  });
  it('allows incremental migration of one role with exact legacy fallback for the other', () => {
    const ai = service({
      CHAT_STANDARD_PROVIDER: undefined,
      CHAT_STANDARD_MODEL: undefined,
      CHAT_PROVIDER: 'yandex',
      YANDEX_MODEL: 'legacy-standard',
    });
    ai.getChatModel('FAST');
    ai.getChatModel('STANDARD');
    expect(
      jest.mocked(ChatOpenAI).mock.calls.map(([config]) => config.model),
    ).toEqual(['gpt://offline/fast', 'legacy-standard']);
  });
  it('uses a new explicit OpenAI alias profile in preference to the legacy profile', () => {
    service({
      CHAT_STANDARD_MODEL: 'alias',
      CHAT_STANDARD_TRANSPORT_PROFILE: 'gpt-6-luna',
      OPENAI_STANDARD_TRANSPORT_PROFILE: 'gpt-6.1-sol',
    }).getChatModel('STANDARD');
    expect(jest.mocked(ChatOpenAI).mock.calls[0][0]).toMatchObject({
      model: 'alias',
      temperature: 0,
      modelKwargs: { reasoning: { effort: 'none' } },
    });
  });
  it.each(['CHAT_FAST_PROVIDER', 'CHAT_STANDARD_PROVIDER'])(
    'rejects invalid explicit %s instead of silently using a legacy value',
    (key) => {
      for (const value of ['', null, 'unknown'])
        expect(() =>
          service({ [key]: value, CHAT_PROVIDER: 'yandex' }),
        ).toThrow(key);
    },
  );
  it.each(['', null, '   '])(
    'rejects an empty explicit model %p instead of using a legacy model',
    (value) => {
      expect(() =>
        service({
          CHAT_FAST_MODEL: value,
          YANDEX_LITE_MODEL: 'legacy',
        }).getChatModel('FAST'),
      ).toThrow('CHAT_FAST_MODEL');
    },
  );
  it('validates Yandex transport profiles explicitly', () => {
    expect(() =>
      service({ CHAT_FAST_TRANSPORT_PROFILE: 'gpt-6-luna' }).getChatModel(
        'FAST',
      ),
    ).toThrow('CHAT_FAST_TRANSPORT_PROFILE');
    service({ CHAT_FAST_TRANSPORT_PROFILE: 'yandex-chat' }).getChatModel(
      'FAST',
    );
  });
  it.each([
    'not-a-url',
    'ftp://host/v1',
    'https://user:secret@host/v1',
    'https://host/v1?token=secret',
  ])('rejects invalid provider URL without exposing credentials: %s', (url) => {
    expect(() => service({ YANDEX_API_URL: url }).getChatModel('FAST')).toThrow(
      'YANDEX_API_URL must be an HTTP(S) URL',
    );
    try {
      service({ YANDEX_API_URL: url }).getChatModel('FAST');
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
  it('rejects removed gateway mode instead of silently changing routing', () => {
    expect(() => service({ CHAT_MODE: 'gateway' })).toThrow('CHAT_MODE=direct');
  });
  it.each([0, -1, 1.5, '', 'bad', Infinity, NaN, null, false, 2147483648])(
    'rejects unbounded/invalid timeout %p',
    (value) => {
      expect(() => service({ CHAT_REQUEST_TIMEOUT_MS: value })).toThrow(
        'CHAT_REQUEST_TIMEOUT_MS',
      );
    },
  );
  it('configures the SDK timeout without a separate timer manager', () => {
    service({ CHAT_REQUEST_TIMEOUT_MS: '1250' }).getChatModel('FAST');
    expect(jest.mocked(ChatOpenAI).mock.calls[0][0].timeout).toBe(1250);
  });
  it('exposes the existing LangChain base contract, allowing a non-OpenAI model', async () => {
    const model: ReturnType<AiService['getChatModel']> = new FakeListChatModel({
      responses: ['native model result'],
    });
    expect((await model.invoke('hello')).content).toBe('native model result');
    expect(model).not.toBeInstanceOf(ChatOpenAI);
  });
});
