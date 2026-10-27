import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { AiService } from './ai.service';
import { FallbackChatModel } from './chat-fallback';
import { DirectGigaChat } from './gigachat-model';
import { embeddingSpace } from './embedding-execution';

const config = {
  CHAT_FAST: 'yandex-lite', CHAT_STANDARD: 'yandex-standard', EMBEDDING_PROVIDER: 'yandex',
  YANDEX_LITE_MODEL: 'gpt://fixture/yandexgpt-lite/latest', YANDEX_MODEL: 'gpt://fixture/yandexgpt/latest',
  YANDEX_API_KEY: 'offline', YANDEX_API_URL: 'https://yandex.invalid/v1',
};
const service = (extra: Record<string, unknown> = {}) => new AiService({ get: key => ({ ...config, ...extra })[key] } as ConfigService);

describe('named deployments, access service and independent embeddings', () => {
  it('Yandex aliases need no unused keys; named selection wins over all legacy role fields', () => {
    const ai = service({ CHAT_FAST_PROVIDER: 'unknown', CHAT_FAST_MODEL: 'ignored', CHAT_FAST_TRANSPORT_PROFILE: 'ignored' });
    expect((ai.getChatModel('FAST') as ChatOpenAI).model).toBe(config.YANDEX_LITE_MODEL);
    expect((ai.getChatModel('STANDARD') as ChatOpenAI).model).toBe(config.YANDEX_MODEL);
    expect(ai.getChatModel('FAST')).not.toBeInstanceOf(FallbackChatModel);
    expect(ai.getChatModel('FAST')).toBe(ai.getChatModel('FAST'));
  });
  it.each([['FAST', 'qwen-flash', 'qwen/qwen3.8-flash'], ['STANDARD', 'qwen-max', 'qwen/qwen3.8-max']] as const)(
    '%s independently configures Yandex -> Polza with exactly the named model', (role, alias, model) => {
      const ai = service({ [`CHAT_${role}_FALLBACK`]: alias, POLZA_API_KEY: 'offline', [`CHAT_${role}_FALLBACK_PROVIDER`]: 'ignored' });
      const deployment = ai.getChatModel(role) as any;
      expect(deployment).toBeInstanceOf(FallbackChatModel);
      expect(deployment.primary.model).toBe(role === 'FAST' ? config.YANDEX_LITE_MODEL : config.YANDEX_MODEL);
      expect(deployment.fallback.model).toBe(model);
      expect(deployment.fallback.metadata).toMatchObject({ provider: 'qwen', service: 'polza' });
      expect(deployment.fallback.modelKwargs).not.toHaveProperty('enable_thinking');
      expect(deployment.fallback.useResponsesApi).toBe(false);
      expect(ai.getChatModel(role === 'FAST' ? 'STANDARD' : 'FAST')).not.toBeInstanceOf(FallbackChatModel);
      expect(ai.embeddingFailover).toBe(false);
    },
  );
  it('retains old Alibaba configuration and does not confuse its credentials/profile with Polza', () => {
    const model = service({ CHAT_FAST: undefined, CHAT_FAST_PROVIDER: 'qwen', CHAT_FAST_MODEL: 'qwen-custom', QWEN_API_URL: 'https://alibaba.invalid/v1', QWEN_API_KEY: 'offline' }).getChatModel('FAST') as ChatOpenAI;
    expect(model.modelKwargs.enable_thinking).toBe(false);
    expect(() => service({ CHAT_FAST: 'qwen-flash', QWEN_API_KEY: 'wrong service' }).getChatModel('FAST')).toThrow('POLZA_API_KEY');
  });
  it('OpenAI and GigaChat alternatives remain constructible without another provider key', () => {
    expect((service({ CHAT_FAST: 'gpt-6-luna', OPENAI_API_KEY: 'offline' }).getChatModel('FAST') as ChatOpenAI).useResponsesApi).toBe(true);
    expect(service({ CHAT_FAST: 'gigachat-2', GIGACHAT_ACCESS_TOKEN: 'offline' }).getChatModel('FAST')).toBeInstanceOf(DirectGigaChat);
  });
  it.each(['unknown', '', 'constructor'])('invalid alias %s fails explicitly', value => {
    expect(() => service({ CHAT_FAST: value })).toThrow('CHAT_FAST');
  });
  it('Qwen embedding spec is independent, service-qualified, and model/dimension changes invalidate the space', () => {
    const a = service({ EMBEDDING_FALLBACK_PROVIDER: 'qwen' });
    const b = service({ QWEN_EMBEDDING_MODEL: 'qwen/qwen3-embedding-8b' });
    expect(a.embeddingFallbackProvider).toBe('qwen');
    expect(a.getEmbeddingSpec('qwen')).toMatchObject({ dimensions: 2560, service: 'polza' });
    expect(b.getEmbeddingSpec('qwen').dimensions).toBe(4096);
    expect(embeddingSpace(a.getEmbeddingSpec('qwen'))).not.toBe(embeddingSpace(b.getEmbeddingSpec('qwen')));
    expect(embeddingSpace(a.getEmbeddingSpec('qwen'))).not.toBe(embeddingSpace(service({ QWEN_EMBEDDING_DIMENSIONS: 1024 }).getEmbeddingSpec('qwen')));
    expect(a.secondaryEmbeddingCollection('products')).toBe('products_fallback');
    expect(a.secondaryEmbeddingCollection('store_knowledge')).toBe('store_knowledge_fallback');
    expect(() => service({ QWEN_EMBEDDING_MODEL: 'custom' }).getEmbeddingSpec('qwen')).toThrow('DIMENSIONS');
    expect(() => service({ QDRANT_PRODUCTS_SECONDARY_COLLECTION: 'products' }).secondaryEmbeddingCollection('products')).toThrow('separate');
    expect(() => service({ QDRANT_PRODUCTS_SECONDARY_COLLECTION: 'store_knowledge_fallback' }).secondaryEmbeddingCollection('products')).toThrow('different');
  });
});
