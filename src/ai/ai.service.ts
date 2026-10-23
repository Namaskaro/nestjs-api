import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { OpenAI } from 'openai/client.js';

import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { CreateProductEmbeddingText } from './dto/create-product-embedding-text.dto';

import { ProductSemanticInputDto } from './dto/product-semantic-input.dto';

import {
  ProductSemanticRepresentation,
  ProductSemanticRepresentationSchema,
} from './schemas/semantic-product-representation.schema';

import { productSemanticRepresentationPrompt } from './prompts/product-semantic-representation.prompt';

import { llmUsageCallback } from './llm-usage';

import { DirectGigaChat } from './gigachat-model';
import { getChatTransport } from './chat-transport';
import { createChatFetch } from './chat-http';

export type AiProvider = 'openai' | 'yandex';

export type ChatProvider = AiProvider | 'qwen' | 'gigachat';

// STRONG is reserved; no current operation or deployment needs to configure it.
export type ChatModelRole = 'FAST' | 'STANDARD' | 'STRONG';

const YANDEX_EMBEDDING_API_URL =
  'https://ai.api.cloud.yandex.net:443/foundationModels/v1/textEmbedding';

type YandexEmbeddingResponse = {
  embedding: Array<number | string>;
};

@Injectable()
export class AiService {
  private readonly chatProviders: Record<'FAST' | 'STANDARD', ChatProvider>;

  private readonly chatTimeoutMs: number;

  private readonly embeddingProvider: AiProvider;

  private readonly chatModels = new Map<ChatModelRole, BaseChatModel>();

  private openAiEmbeddingClient?: OpenAI;

  public constructor(private readonly configService: ConfigService) {
    const mode = this.configService.get<unknown>('CHAT_MODE') ?? 'direct';
    if (mode !== 'direct') {
      throw new Error(
        'AiService configuration: only CHAT_MODE=direct is supported; configure direct provider credentials before removing gateway mode.',
      );
    }
    this.chatProviders = {
      FAST: this.getChatProvider(this.chatProviderKey('FAST')),
      STANDARD: this.getChatProvider(this.chatProviderKey('STANDARD')),
    };
    this.embeddingProvider = this.getProvider('EMBEDDING_PROVIDER');
    const configuredTimeout = this.configService.get<unknown>(
      'CHAT_REQUEST_TIMEOUT_MS',
    );
    const timeout =
      configuredTimeout === undefined ? 60_000 : configuredTimeout;
    this.chatTimeoutMs =
      typeof timeout === 'number' || typeof timeout === 'string'
        ? Number(timeout)
        : NaN;
    if (
      !Number.isInteger(this.chatTimeoutMs) ||
      this.chatTimeoutMs <= 0 ||
      this.chatTimeoutMs > 2_147_483_647
    ) {
      throw new Error(
        'AiService configuration: CHAT_REQUEST_TIMEOUT_MS must be an integer between 1 and 2147483647.',
      );
    }
  }

  private chatProviderKey(role: 'FAST' | 'STANDARD'): string {
    const key = `CHAT_${role}_PROVIDER`;
    return this.configService.get<unknown>(key) === undefined
      ? 'CHAT_PROVIDER'
      : key;
  }

  private requireConfig(key: string): string {
    const value = this.configService.get<unknown>(key);

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `AiService configuration: ${key} must be a non-empty string.`,
      );
    }

    return value.trim();
  }

  private getProvider(key: string): AiProvider {
    const provider = this.configService.get<unknown>(key);

    if (provider !== 'openai' && provider !== 'yandex') {
      throw new Error(
        `AiService configuration: ${key} must be "openai" or "yandex". ` +
          `Set ${key} explicitly; AI_PROVIDER is no longer used.`,
      );
    }

    return provider;
  }

  private getChatProvider(key: string): ChatProvider {
    const provider = this.configService.get<unknown>(key);
    if (provider !== 'openai' && provider !== 'yandex' && provider !== 'qwen' && provider !== 'gigachat') {
      throw new Error(
        `AiService configuration: ${key} must be "openai", "yandex", "qwen" or "gigachat". ` +
          `Set ${key} explicitly; AI_PROVIDER is no longer used.`,
      );
    }
    return provider;
  }

  private getEmbeddingDimensions(key: string, fallback: number): number {
    const value = this.configService.get<string | number>(key);

    if (value === undefined) {
      return fallback;
    }

    const dimensions = Number(value);

    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Некорректная размерность embeddings в ${key}: ${value}`);
    }

    return dimensions;
  }

  public getChatModel(role: ChatModelRole): BaseChatModel {
    if (role !== 'FAST' && role !== 'STANDARD') {
      throw new Error(
        `AiService configuration: unsupported chat role "${role}". ` +
          'Use FAST or STANDARD; STRONG is reserved.',
      );
    }

    const cached = this.chatModels.get(role);

    if (cached) {
      return cached;
    }

    const provider = this.chatProviders[role];
    const isYandex = provider === 'yandex';
    const legacyModelKey =
      (provider === 'qwen' || provider === 'gigachat')
        ? `CHAT_${role}_MODEL`
        : isYandex
        ? role === 'FAST'
          ? 'YANDEX_LITE_MODEL'
          : 'YANDEX_MODEL'
        : role === 'FAST'
        ? 'OPENAI_FAST_MODEL'
        : 'OPENAI_STANDARD_MODEL';
    const roleModelKey = `CHAT_${role}_MODEL`;
    const model = this.requireConfig(
      this.configService.get<unknown>(roleModelKey) === undefined
        ? legacyModelKey
        : roleModelKey,
    );
    const roleProfileKey = `CHAT_${role}_TRANSPORT_PROFILE`;
    const profileKey =
      this.configService.get<unknown>(roleProfileKey) === undefined &&
      provider === 'openai'
        ? `OPENAI_${role}_TRANSPORT_PROFILE`
        : roleProfileKey;
    if (provider === 'gigachat') {
      const profile = this.configService.get(profileKey);
      if (profile !== undefined && profile !== 'gigachat-native') throw new Error(profileKey + ' must be gigachat-native');
      const native = new DirectGigaChat({ model, timeoutMs: this.chatTimeoutMs,
        credentials: this.configService.get('GIGACHAT_CREDENTIALS'), accessToken: this.configService.get('GIGACHAT_ACCESS_TOKEN'),
        scope: this.configService.get('GIGACHAT_SCOPE'), baseURL: this.configService.get('GIGACHAT_API_URL'), authURL: this.configService.get('GIGACHAT_AUTH_URL'),
      }, { callbacks: [llmUsageCallback], tags: [`role:${role}`, `provider:${provider}`, `model:${model}`], metadata: { role, provider, model } });
      this.chatModels.set(role, native);
      return native;
    }
    const transport = getChatTransport(
      provider,
      role,
      model,
      this.configService.get<unknown>(profileKey),
      profileKey,
    );
    const baseUrlKey = isYandex ? 'YANDEX_API_URL' : 'QWEN_API_URL';
    const baseURL =
      provider !== 'openai' ? this.requireConfig(baseUrlKey) : undefined;
    if (baseURL) {
      let valid = false;
      try {
        const url = new URL(baseURL);
        valid =
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash;
      } catch {
        /* Report the variable name without exposing its value. */
      }
      if (!valid)
        throw new Error(
          `AiService configuration: ${baseUrlKey} must be an HTTP(S) URL without credentials, query or fragment.`,
        );
    }
    const chatModel = new ChatOpenAI({
      apiKey: this.requireConfig(
        isYandex
          ? 'YANDEX_API_KEY'
          : provider === 'qwen'
          ? 'QWEN_API_KEY'
          : 'OPENAI_API_KEY',
      ),
      model,
      ...transport,
      // Graph event callbacks otherwise make invoke() stream implicitly. Buffer
      // the provider response so completion safety runs before tools/parsers.
      disableStreaming: true,
      maxRetries: 0,
      timeout: this.chatTimeoutMs,
      configuration: {
        ...(baseURL ? { baseURL } : {}),
        fetch: createChatFetch({
          api: transport.useResponsesApi ? 'responses' : 'chat-completions',
        }),
      },
      callbacks: [llmUsageCallback],
      tags: [`role:${role}`, `provider:${provider}`, `model:${model}`],
      metadata: { role, provider, model },
    });

    this.chatModels.set(role, chatModel);
    return chatModel;
  }

  private getOpenAiEmbeddingClient(): OpenAI {
    this.openAiEmbeddingClient ??= new OpenAI({
      apiKey: this.requireConfig('OPENAI_API_KEY'),
    });

    return this.openAiEmbeddingClient;
  }

  public async createOpenAiEmbedding(text: string): Promise<number[]> {
    const response = await this.getOpenAiEmbeddingClient().embeddings.create({
      model: this.requireConfig('OPENAI_EMBEDDING_MODEL'),

      input: text,

      dimensions: this.getEmbeddingDimensions(
        'OPENAI_EMBEDDING_DIMENSIONS',
        1536,
      ),
    });

    const embedding = response.data[0]?.embedding;

    if (!embedding) {
      throw new Error('OpenAI не вернул embedding');
    }

    return embedding;
  }

  public async createOpenAiEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.getOpenAiEmbeddingClient().embeddings.create({
      model: this.requireConfig('OPENAI_EMBEDDING_MODEL'),

      input: texts,

      dimensions: this.getEmbeddingDimensions(
        'OPENAI_EMBEDDING_DIMENSIONS',
        1536,
      ),
    });

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  private async createYandexEmbedding(
    text: string,
    modelUri: string,
  ): Promise<number[]> {
    const apiKey = this.requireConfig('YANDEX_API_KEY');

    const folderId = this.requireConfig('YANDEX_FOLDER_ID');

    const dimensions = this.getEmbeddingDimensions(
      'YANDEX_EMBEDDING_DIMENSIONS',
      768,
    );

    const response = await fetch(YANDEX_EMBEDDING_API_URL, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',

        Authorization: `Bearer ${apiKey}`,

        'x-folder-id': folderId,
      },

      body: JSON.stringify({
        modelUri,

        text,

        dim: String(dimensions),
      }),
    });

    if (!response.ok) {
      const error = await response.text();

      throw new Error(`Yandex Embeddings API: ${response.status} ${error}`);
    }

    const data = (await response.json()) as YandexEmbeddingResponse;

    return data.embedding.map(Number);
  }

  public async createYandexQueryEmbedding(text: string): Promise<number[]> {
    const modelUri = this.requireConfig('YANDEX_EMBEDDING_QUERY_MODEL');

    return this.createYandexEmbedding(text, modelUri);
  }

  public async createYandexDocumentEmbedding(text: string): Promise<number[]> {
    const modelUri = this.requireConfig('YANDEX_EMBEDDING_DOCUMENT_MODEL');

    return this.createYandexEmbedding(text, modelUri);
  }

  public async createYandexDocumentEmbeddings(
    texts: string[],
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    return Promise.all(
      texts.map((text) => this.createYandexDocumentEmbedding(text)),
    );
  }

  public async createQueryEmbedding(text: string): Promise<number[]> {
    const provider = this.embeddingProvider;

    if (provider === 'openai') {
      return this.createOpenAiEmbedding(text);
    }

    return this.createYandexQueryEmbedding(text);
  }

  public async createDocumentEmbedding(text: string): Promise<number[]> {
    const provider = this.embeddingProvider;

    if (provider === 'openai') {
      return this.createOpenAiEmbedding(text);
    }

    return this.createYandexDocumentEmbedding(text);
  }

  public async createDocumentEmbeddings(texts: string[]): Promise<number[][]> {
    const provider = this.embeddingProvider;

    if (provider === 'openai') {
      return this.createOpenAiEmbeddings(texts);
    }

    return this.createYandexDocumentEmbeddings(texts);
  }

  public async createProductEmbedding(text: string): Promise<number[]> {
    return this.createDocumentEmbedding(text);
  }

  public async createProductSemanticRepresentation(
    product: ProductSemanticInputDto,
  ): Promise<ProductSemanticRepresentation> {
    const model = this.getChatModel('STANDARD');

    const structuredModel = model.withStructuredOutput(
      ProductSemanticRepresentationSchema,
      {
        name: 'create_product_semantic_representation',
      },
    );

    const prompt = await productSemanticRepresentationPrompt.invoke(product);

    const result = await structuredModel.invoke(prompt);

    return ProductSemanticRepresentationSchema.parse(result);
  }

  public buildProductSearchText(
    product: ProductSemanticInputDto,

    semantic: ProductSemanticRepresentation,
  ): string {
    const lines = [
      `Название: ${product.title}`,

      `Описание: ${product.description}`,

      `Бренд: ${product.brand}`,

      `Подкатегория: ${product.subcategory}`,

      product.color ? `Цвет: ${product.color}` : null,

      product.details.length > 0
        ? `Детали: ${product.details.join(', ')}`
        : null,

      `Цена: ${product.price}`,

      `Семантическое описание: ${semantic.summary}`,

      semantic.targetAudience.length > 0
        ? `Целевая аудитория: ${semantic.targetAudience.join(', ')}`
        : null,

      semantic.styleAssociations.length > 0
        ? `Стиль: ${semantic.styleAssociations.join(', ')}`
        : null,

      semantic.useCases.length > 0
        ? `Сценарии использования: ${semantic.useCases.join(', ')}`
        : null,

      semantic.pricePositioning !== 'не удалось определить по имеющимся данным'
        ? `Ценовое позиционирование: ${semantic.pricePositioning}`
        : null,

      semantic.searchTags.length > 0
        ? `Поисковые формулировки: ${semantic.searchTags.join(', ')}`
        : null,
    ];

    return lines.filter((line): line is string => line !== null).join('\n');
  }

  public async buildProductEmbeddingText(product: CreateProductEmbeddingText) {
    return `
      Название: ${product.title}
      Описание: ${product.description}
      Бренд: ${product.brand}
      Категория: ${product.subcategory}
      Цена: ${product.price}
      `.trim();
  }
}
