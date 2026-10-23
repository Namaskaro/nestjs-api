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
import { EmbeddingRequestError, embeddingHttpFailure, validateEmbedding, type EmbeddingSpec, type EmbeddingOptions } from './embedding-execution';

export type AiProvider = 'openai' | 'yandex';

export type ChatProvider = AiProvider | 'qwen' | 'gigachat';

// STRONG is reserved; no current operation or deployment needs to configure it.
export type ChatModelRole = 'FAST' | 'STANDARD' | 'STRONG';

const YANDEX_EMBEDDING_API_URL =
  'https://ai.api.cloud.yandex.net:443/foundationModels/v1/textEmbedding';

@Injectable()
export class AiService {
  public readonly embeddingFailover: boolean;
  private readonly embeddingTimeoutMs: number;
  private readonly chatProviders: Record<'FAST' | 'STANDARD', ChatProvider>;

  private readonly chatTimeoutMs: number;

  private readonly embeddingProvider: AiProvider;

  private readonly chatModels = new Map<ChatModelRole, BaseChatModel>();

  private openAiEmbeddingClient?: OpenAI;

  public constructor(private readonly configService: ConfigService) {
    const failover = this.configService.get<unknown>('EMBEDDING_FAILOVER_ENABLED');
    if (failover !== undefined && !['true', 'false', true, false].includes(failover as boolean))
      throw new Error('EMBEDDING_FAILOVER_ENABLED must be true or false');
    this.embeddingFailover = failover === true || failover === 'true';
    this.embeddingTimeoutMs = Number(this.configService.get('EMBEDDING_REQUEST_TIMEOUT_MS') ?? 60000);
    if (!Number.isInteger(this.embeddingTimeoutMs) || this.embeddingTimeoutMs <= 0 || this.embeddingTimeoutMs > 2147483647)
      throw new Error('EMBEDDING_REQUEST_TIMEOUT_MS must be a positive integer <= 2147483647');
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
    if (this.embeddingFailover && this.embeddingProvider !== 'yandex')
      throw new Error('Embedding failover requires primary EMBEDDING_PROVIDER=yandex');
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

  public getEmbeddingSpec(provider: AiProvider): EmbeddingSpec {
    return provider === 'yandex'
      ? { provider, queryModel: this.requireConfig('YANDEX_EMBEDDING_QUERY_MODEL'),
          documentModel: this.requireConfig('YANDEX_EMBEDDING_DOCUMENT_MODEL'),
          dimensions: this.getEmbeddingDimensions('YANDEX_EMBEDDING_DIMENSIONS', 768) }
      : { provider, queryModel: this.requireConfig('OPENAI_EMBEDDING_MODEL'),
          documentModel: this.requireConfig('OPENAI_EMBEDDING_MODEL'),
          dimensions: this.getEmbeddingDimensions('OPENAI_EMBEDDING_DIMENSIONS', 1536) };
  }

  public secondaryEmbeddingCollection(collection: string): string {
    const key = collection === 'products' ? 'QDRANT_PRODUCTS_SECONDARY_COLLECTION'
      : collection === 'store_knowledge' ? 'QDRANT_KNOWLEDGE_SECONDARY_COLLECTION' : undefined;
    if (!key) throw new Error('Unsupported logical embedding collection');
    const name = this.requireConfig(key);
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || ['products','store_knowledge'].includes(name))
      throw new Error(key + ' must name a separate collection');
    const other = this.configService.get(collection === 'products' ? 'QDRANT_KNOWLEDGE_SECONDARY_COLLECTION' : 'QDRANT_PRODUCTS_SECONDARY_COLLECTION');
    if (name === other) throw new Error('Secondary product and knowledge collections must be different');
    return name;
  }

  public async createEmbedding(text: string, provider: AiProvider, kind: 'query' | 'document', options: EmbeddingOptions = {}): Promise<number[]> {
    return (await this.requestEmbedding(text, provider, kind, options))[0];
  }

  private async requestEmbedding(text: string | string[], provider: AiProvider, kind: 'query' | 'document', options: EmbeddingOptions = {}): Promise<number[][]> {
    options.signal?.throwIfAborted();
    const apiKey = this.requireConfig(provider === 'yandex' ? 'YANDEX_API_KEY' : 'OPENAI_API_KEY');
    const spec = this.getEmbeddingSpec(provider);
    const timeout = AbortSignal.timeout(this.embeddingTimeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      if (provider === 'openai') {
        this.openAiEmbeddingClient ??= new OpenAI({ apiKey, maxRetries: 0, timeout: this.embeddingTimeoutMs });
        const result = await this.openAiEmbeddingClient.embeddings.create({
          model: kind === 'query' ? spec.queryModel : spec.documentModel, input: text, dimensions: spec.dimensions, encoding_format: 'float',
        }, { signal, maxRetries: 0, timeout: this.embeddingTimeoutMs });
        signal.throwIfAborted();
        const count = Array.isArray(text) ? text.length : 1;
        if (!Array.isArray(result.data)) throw new EmbeddingRequestError('invalid-response', provider);
        const ordered = [...result.data].sort((a, b) => a.index - b.index);
        if (ordered.length !== count || ordered.some((row, index) => row.index !== index))
          throw new EmbeddingRequestError('invalid-response', provider);
        return ordered.map(row => validateEmbedding(row.embedding, spec));
      }
      const auth = this.configService.get<string>('YANDEX_EMBEDDING_AUTH_TYPE') ?? 'iam';
      if (!['iam', 'api-key'].includes(auth)) throw new Error('YANDEX_EMBEDDING_AUTH_TYPE must be iam or api-key');
      const response = await fetch(YANDEX_EMBEDDING_API_URL, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: (auth === 'iam' ? 'Bearer ' : 'Api-Key ') + apiKey,
          'x-folder-id': this.requireConfig('YANDEX_FOLDER_ID') },
        body: JSON.stringify({ modelUri: kind === 'query' ? spec.queryModel : spec.documentModel, text, dim: String(spec.dimensions) }),
      });
      const textBody = await response.text();
      signal.throwIfAborted();
      let body: any;
      try { body = JSON.parse(textBody); } catch { /* Keep HTTP status classification for non-JSON error bodies. */ }
      if (!response.ok) throw embeddingHttpFailure(provider, response.status, String(body?.error?.code ?? body?.code ?? ''));
      return [validateEmbedding(body?.embedding, spec)];
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof EmbeddingRequestError) throw error;
      if (!error || typeof error !== 'object') throw error;
      const failure = error as { name?: string; status?: number; code?: string; cause?: { code?: string }; message?: string };
      if (timeout.aborted || failure.name === 'APIConnectionTimeoutError')
        throw new EmbeddingRequestError('availability', provider, undefined, { cause: error });
      if (typeof failure.status === 'number') {
        const classified = embeddingHttpFailure(provider, failure.status, failure.code);
        throw new EmbeddingRequestError(classified.category, provider, failure.status, { cause: error });
      }
      if (failure.name === 'APIConnectionError' || (error as any)?.constructor?.name === 'APIConnectionError' ||
        (failure.name === 'TypeError' && /^(fetch failed|Failed to fetch)$/.test(failure.message ?? ''))) {
        let cause = error as any;
        for (let depth = 0; cause && depth < 8; depth++, cause = cause.cause) {
          if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(cause.code ?? ''))
            throw new EmbeddingRequestError('availability', provider, undefined, { cause: error });
        }
      }
      throw error;
    }
  }

  public createOpenAiEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return this.createEmbedding(text, 'openai', 'document', options);
  }
  public async createOpenAiEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    if (!texts.length) return [];
    return this.requestEmbedding(texts, 'openai', 'document', options);
  }
  public createYandexQueryEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return this.createEmbedding(text, 'yandex', 'query', options);
  }
  public createYandexDocumentEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return this.createEmbedding(text, 'yandex', 'document', options);
  }
  public async createYandexDocumentEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) results.push(await this.createYandexDocumentEmbedding(text, options));
    return results;
  }
  public createQueryEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return this.createEmbedding(text, this.embeddingProvider, 'query', options);
  }
  public createDocumentEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return this.createEmbedding(text, this.embeddingProvider, 'document', options);
  }
  public async createDocumentEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    if (this.embeddingProvider === 'openai') return this.createOpenAiEmbeddings(texts, options);
    const results: number[][] = [];
    for (const text of texts) results.push(await this.createDocumentEmbedding(text, options));
    return results;
  }
  public createProductEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return this.createDocumentEmbedding(text, options);
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
