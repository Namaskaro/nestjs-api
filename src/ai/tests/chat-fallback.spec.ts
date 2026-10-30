import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AiService } from './ai.service';
import { FallbackChatModel, isChatAvailabilityFailure } from './chat-fallback';

const config = {
  CHAT_PROVIDER: 'yandex',
  EMBEDDING_PROVIDER: 'yandex',
  YANDEX_API_KEY: 'offline',
  YANDEX_API_URL: 'https://yandex.invalid/v1',
  YANDEX_MODEL: 'primary-standard',
  YANDEX_LITE_MODEL: 'primary-fast',
  OPENAI_API_KEY: 'offline',
};
const service = (values: Record<string, unknown>) =>
  new AiService({
    get: (key: string) => ({ ...config, ...values }[key]),
  } as ConfigService);
describe('independent deployments and conservative availability classification', () => {
  it('FAST and STANDARD configure fallback independently; embeddings remain Yandex', () => {
    const ai = service({
      CHAT_FAST_FALLBACK_PROVIDER: 'openai',
      CHAT_FAST_FALLBACK_MODEL: 'gpt-6.1-sol',
    });
    expect(ai.getChatModel('FAST')).toBeInstanceOf(FallbackChatModel);
    expect(ai.getChatModel('STANDARD')).not.toBeInstanceOf(FallbackChatModel);
    expect(ai.getChatModel('FAST')).toBeInstanceOf(BaseChatModel);
  });
  it('explicit fallback needs a model; incomplete configuration never degrades silently', () => {
    expect(() =>
      service({ CHAT_STANDARD_FALLBACK_PROVIDER: 'openai' }).getChatModel(
        'STANDARD',
      ),
    ).toThrow('CHAT_STANDARD_FALLBACK_MODEL');
  });
  it('TLS, malformed completion, arbitrary code errors and ambiguous 429 never fail over', () => {
    for (const error of [
      new TypeError('bug'),
      { status: 429 },
      { status: 429, code: 'insufficient_quota' },
      { name: 'TimeoutError', message: 'node timeout' },
      { name: 'APIConnectionError', cause: { name: 'ChatTransportError' } },
      {
        name: 'APIConnectionError',
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      },
    ])
      expect(isChatAvailabilityFailure(error)).toBe(false);
    expect(
      isChatAvailabilityFailure({
        name: 'APIConnectionError',
        cause: { cause: { code: 'ECONNRESET' } },
      }),
    ).toBe(true);
  });
});
