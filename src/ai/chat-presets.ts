import type { ChatProvider } from './ai.service';

// Model manufacturer and access service are distinct (Qwen/Polza vs Qwen/Alibaba).
// These are deployment defaults, never application routing rules.
type ChatPreset = {
  provider: ChatProvider;
  service: string;
  model?: string;
  modelEnv?: string;
  profile: string;
  baseURL?: string;
  baseURLEnv?: string;
  credentialEnv: string;
};

export const CHAT_PRESETS: Readonly<Record<string, ChatPreset>> = {
  'yandex-lite': { provider: 'yandex', service: 'yandex', modelEnv: 'YANDEX_LITE_MODEL', profile: 'yandex-chat', baseURLEnv: 'YANDEX_API_URL', credentialEnv: 'YANDEX_API_KEY' },
  'yandex-standard': { provider: 'yandex', service: 'yandex', modelEnv: 'YANDEX_MODEL', profile: 'yandex-chat', baseURLEnv: 'YANDEX_API_URL', credentialEnv: 'YANDEX_API_KEY' },
  'qwen-flash': { provider: 'qwen', service: 'polza', model: 'qwen/qwen3.8-flash', profile: 'polza-chat', baseURL: 'https://polza.ai/api/v1', credentialEnv: 'POLZA_API_KEY' },
  'qwen-max': { provider: 'qwen', service: 'polza', model: 'qwen/qwen3.8-max', profile: 'polza-chat', baseURL: 'https://polza.ai/api/v1', credentialEnv: 'POLZA_API_KEY' },
  'gigachat-2': { provider: 'gigachat', service: 'sber', model: 'GigaChat-2', profile: 'gigachat-native', baseURLEnv: 'GIGACHAT_API_URL', credentialEnv: 'GIGACHAT_CREDENTIALS' },
  'gpt-6-luna': { provider: 'openai', service: 'openai', model: 'gpt-6-luna', profile: 'gpt-6-luna', baseURL: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_API_KEY' },
  'gpt-6.1-sol': { provider: 'openai', service: 'openai', model: 'gpt-6.1-sol', profile: 'gpt-6.1-sol', baseURL: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_API_KEY' },
};

export function chatPreset(value: unknown, key: string): ChatPreset | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(CHAT_PRESETS, value))
    throw new Error(`${key} must name a CHAT_PRESETS entry`);
  return CHAT_PRESETS[value];
}
