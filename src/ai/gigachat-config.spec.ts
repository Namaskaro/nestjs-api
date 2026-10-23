import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AiService } from './ai.service';
import { DirectGigaChat } from './gigachat-model';

const config = {
  CHAT_PROVIDER: 'yandex',
  EMBEDDING_PROVIDER: 'yandex',
  YANDEX_API_KEY: 'offline',
  YANDEX_API_URL: 'https://yandex.invalid/v1',
  YANDEX_MODEL: 'primary-standard',
  YANDEX_LITE_MODEL: 'primary-fast',
  QWEN_API_KEY: 'offline',
  QWEN_API_URL: 'https://qwen.invalid/v1',
};
const service = (values: Record<string, unknown>) =>
  new AiService({
    get: (key: string) => ({ ...config, ...values }[key]),
  } as ConfigService);
describe('native GigaChat deployment configuration', () => {
  it('GigaChat is opt-in, native, and requires credentials', () => {
    const values = {
      CHAT_FAST_PROVIDER: 'gigachat',
      CHAT_FAST_MODEL: 'GigaChat-2',
      GIGACHAT_CREDENTIALS: 'offline',
    };
    expect(service(values).getChatModel('FAST')).toBeInstanceOf(DirectGigaChat);
    expect(() =>
      service({ ...values, GIGACHAT_CREDENTIALS: undefined }).getChatModel(
        'FAST',
      ),
    ).toThrow('credentials');
  });
});
