import type { ChatOpenAIFields } from '@langchain/openai';

import type { ChatProvider, ChatModelRole } from './ai.service';

type OpenAiTransportProfile = 'gpt-6-luna' | 'gpt-6.1-sol';

type ChatTransport = Pick<
  ChatOpenAIFields,
  | 'useResponsesApi'
  | 'temperature'
  | 'streamUsage'
  | 'modelKwargs'
  | 'zdrEnabled'
>;

/** Transport belongs to the configured deployment, not to an application role. */
export function getChatTransport(
  provider: ChatProvider,
  role: Exclude<ChatModelRole, 'STRONG'>,
  model: string,
  configuredProfile?: unknown,
  profileKey = `OPENAI_${role}_TRANSPORT_PROFILE`,
): ChatTransport {
  if (provider === 'gigachat') throw new Error('GigaChat requires its native v1 adapter');
  if (provider === 'qwen') {
    if (configuredProfile !== undefined && configuredProfile !== 'qwen-chat') {
      throw new Error(
        `AiService configuration: ${profileKey} must be "qwen-chat" for Qwen.`,
      );
    }
    // This profile targets text models supporting non-thinking + JSON Schema.
    // Thinking-only / Omni deployments require separate conformance, not a silent fallback.
    return {
      useResponsesApi: false,
      temperature: 0,
      streamUsage: false,
      modelKwargs: { enable_thinking: false },
    };
  }

  if (provider === 'yandex') {
    if (
      configuredProfile !== undefined &&
      configuredProfile !== 'yandex-chat'
    ) {
      throw new Error(
        `AiService configuration: ${profileKey} must be "yandex-chat" for Yandex.`,
      );
    }
    return { useResponsesApi: false, temperature: 0, streamUsage: false };
  }

  const knownProfile: OpenAiTransportProfile | undefined =
    model === 'gpt-6-luna' || model === 'gpt-6.1-sol' ? model : undefined;
  const profile = configuredProfile ?? knownProfile;
  const key = profileKey;

  if (profile !== 'gpt-6-luna' && profile !== 'gpt-6.1-sol') {
    throw new Error(
      `AiService configuration: ${key} must be "gpt-6-luna" or "gpt-6.1-sol" ` +
        'for a custom model ID. Unknown deployments are not inferred by model-name prefix.',
    );
  }
  if (knownProfile && profile !== knownProfile) {
    throw new Error(
      `AiService configuration: ${key} conflicts with model ${model}.`,
    );
  }

  return {
    useResponsesApi: true,
    ...(profile === 'gpt-6-luna' ? { temperature: 0 } : {}),
    // Keep conversation state in the application. This SDK flag sets store:false;
    // it does not enable account-level Zero Data Retention.
    zdrEnabled: true,
    modelKwargs: {
      // @langchain/openai 1.5.6's reasoning-model detection omits GPT-6 and aliases.
      // Pass this explicitly on the wire until that SDK behavior is upgraded/tested.
      reasoning: { effort: profile === 'gpt-6-luna' ? 'none' : 'medium' },
      include: ['reasoning.encrypted_content'],
    },
  };
}
