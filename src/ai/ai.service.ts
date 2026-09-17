// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { OpenAI } from 'openai/client.js';
// import { ChatOpenAI } from '@langchain/openai';

// import { CreateProductEmbeddingText } from './dto/create-product-embedding-text.dto';
// import { ProductSemanticInputDto } from './dto/product-semantic-input.dto';
// import {
//   ProductSemanticRepresentation,
//   ProductSemanticRepresentationSchema,
// } from './schemas/semantic-product-representation.schema';
// import { productSemanticRepresentationPrompt } from './prompts/product-semantic-representation.prompt';

// export type AiProvider = 'openai' | 'yandex';

// const YANDEX_EMBEDDING_API_URL =
//   'https://ai.api.cloud.yandex.net:443/foundationModels/v1/textEmbedding';

// type YandexEmbeddingResponse = {
//   embedding: Array<number | string>;
// };

// @Injectable()
// export class AiService {
//   private readonly openAiChatModel: ChatOpenAI;
//   private readonly yandexChatModel: ChatOpenAI;
//   private readonly yandexLiteChatModel: ChatOpenAI;

//   public constructor(
//     private readonly configService: ConfigService,
//     private readonly openaiService: OpenAI,
//   ) {
//     this.openAiChatModel = new ChatOpenAI({
//       apiKey: this.configService.getOrThrow<string>('OPENAI_API_KEY'),

//       model:
//         this.configService.get<string>('OPENAI_CHAT_MODEL') ?? 'gpt-4.1-mini',

//       temperature: 0,
//     });

//     this.yandexChatModel = new ChatOpenAI({
//       apiKey: this.configService.getOrThrow<string>('YANDEX_API_KEY'),

//       model: this.configService.getOrThrow<string>('YANDEX_MODEL'),

//       temperature: 0,

//       configuration: {
//         baseURL: this.configService.getOrThrow<string>('YANDEX_API_URL'),
//       },

//       streamUsage: false,

//       // ИЗМЕНЕНО: retries LLM-вызовов support-agent контролирует LangGraph.
//       maxRetries: 0,
//     });

//     this.yandexLiteChatModel = new ChatOpenAI({
//       apiKey: this.configService.getOrThrow<string>('YANDEX_API_KEY'),

//       model: this.configService.getOrThrow<string>('YANDEX_LITE_MODEL'),

//       temperature: 0,

//       configuration: {
//         baseURL: this.configService.getOrThrow<string>('YANDEX_API_URL'),
//       },

//       streamUsage: false,

//       maxRetries: 0,
//     });
//   }

//   private getAiProvider(): AiProvider {
//     const provider = this.configService.get<string>('AI_PROVIDER') ?? 'yandex';

//     if (provider !== 'openai' && provider !== 'yandex') {
//       throw new Error(
//         `Неизвестный AI_PROVIDER: ${provider}. ` +
//           'Ожидается "openai" или "yandex"',
//       );
//     }

//     return provider;
//   }

//   private getEmbeddingDimensions(key: string, fallback: number): number {
//     const value = this.configService.get<string | number>(key);

//     if (value === undefined) {
//       return fallback;
//     }

//     const dimensions = Number(value);

//     if (!Number.isInteger(dimensions) || dimensions <= 0) {
//       throw new Error(`Некорректная размерность embeddings в ${key}: ${value}`);
//     }

//     return dimensions;
//   }

//   public getChatModel(provider?: AiProvider): ChatOpenAI {
//     const activeProvider = provider ?? this.getAiProvider();

//     if (activeProvider === 'openai') {
//       return this.openAiChatModel;
//     }

//     return this.yandexChatModel;
//   }

//   public getYandexLiteChatModel(): ChatOpenAI {
//     return this.yandexLiteChatModel;
//   }

//   public async createOpenAiEmbedding(text: string): Promise<number[]> {
//     const response = await this.openaiService.embeddings.create({
//       model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),

//       input: text,

//       dimensions: this.getEmbeddingDimensions(
//         'OPENAI_EMBEDDING_DIMENSIONS',
//         1536,
//       ),
//     });

//     const embedding = response.data[0]?.embedding;

//     if (!embedding) {
//       throw new Error('OpenAI не вернул embedding');
//     }

//     return embedding;
//   }

//   public async createOpenAiEmbeddings(texts: string[]): Promise<number[][]> {
//     if (texts.length === 0) {
//       return [];
//     }

//     const response = await this.openaiService.embeddings.create({
//       model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),

//       input: texts,

//       dimensions: this.getEmbeddingDimensions(
//         'OPENAI_EMBEDDING_DIMENSIONS',
//         1536,
//       ),
//     });

//     return response.data
//       .sort((a, b) => a.index - b.index)
//       .map((item) => item.embedding);
//   }

//   private async createYandexEmbedding(
//     text: string,
//     modelUri: string,
//   ): Promise<number[]> {
//     const apiKey = this.configService.getOrThrow<string>('YANDEX_API_KEY');

//     const folderId = this.configService.getOrThrow<string>('YANDEX_FOLDER_ID');

//     const dimensions = this.getEmbeddingDimensions(
//       'YANDEX_EMBEDDING_DIMENSIONS',
//       768,
//     );

//     const response = await fetch(YANDEX_EMBEDDING_API_URL, {
//       method: 'POST',

//       headers: {
//         'Content-Type': 'application/json',

//         Authorization: `Bearer ${apiKey}`,

//         'x-folder-id': folderId,
//       },

//       body: JSON.stringify({
//         modelUri,
//         text,
//         dim: String(dimensions),
//       }),
//     });

//     if (!response.ok) {
//       const error = await response.text();

//       throw new Error(`Yandex Embeddings API: ${response.status} ${error}`);
//     }

//     const data = (await response.json()) as YandexEmbeddingResponse;

//     return data.embedding.map(Number);
//   }

//   public async createYandexQueryEmbedding(text: string): Promise<number[]> {
//     const modelUri = this.configService.getOrThrow<string>(
//       'YANDEX_EMBEDDING_QUERY_MODEL',
//     );

//     return this.createYandexEmbedding(text, modelUri);
//   }

//   public async createYandexDocumentEmbedding(text: string): Promise<number[]> {
//     const modelUri = this.configService.getOrThrow<string>(
//       'YANDEX_EMBEDDING_DOCUMENT_MODEL',
//     );

//     return this.createYandexEmbedding(text, modelUri);
//   }

//   public async createYandexDocumentEmbeddings(
//     texts: string[],
//   ): Promise<number[][]> {
//     if (texts.length === 0) {
//       return [];
//     }

//     return Promise.all(
//       texts.map((text) => this.createYandexDocumentEmbedding(text)),
//     );
//   }

//   public async createQueryEmbedding(text: string): Promise<number[]> {
//     const provider = this.getAiProvider();

//     if (provider === 'openai') {
//       return this.createOpenAiEmbedding(text);
//     }

//     return this.createYandexQueryEmbedding(text);
//   }

//   public async createDocumentEmbedding(text: string): Promise<number[]> {
//     const provider = this.getAiProvider();

//     if (provider === 'openai') {
//       return this.createOpenAiEmbedding(text);
//     }

//     return this.createYandexDocumentEmbedding(text);
//   }

//   public async createDocumentEmbeddings(texts: string[]): Promise<number[][]> {
//     const provider = this.getAiProvider();

//     if (provider === 'openai') {
//       return this.createOpenAiEmbeddings(texts);
//     }

//     return this.createYandexDocumentEmbeddings(texts);
//   }

//   public async createProductEmbedding(text: string): Promise<number[]> {
//     return this.createDocumentEmbedding(text);
//   }

//   public async createProductSemanticRepresentation(
//     product: ProductSemanticInputDto,
//   ): Promise<ProductSemanticRepresentation> {
//     const model = this.getChatModel();

//     // ИЗМЕНЕНО: убран диагностический explicit functionCalling.
//     const structuredModel = model.withStructuredOutput(
//       ProductSemanticRepresentationSchema,
//       {
//         name: 'create_product_semantic_representation',
//       },
//     );

//     const prompt = await productSemanticRepresentationPrompt.invoke(product);

//     return structuredModel.invoke(prompt);
//   }

//   public buildProductSearchText(
//     product: ProductSemanticInputDto,
//     semantic: ProductSemanticRepresentation,
//   ): string {
//     const lines = [
//       `Название: ${product.title}`,
//       `Описание: ${product.description}`,
//       `Бренд: ${product.brand}`,
//       `Подкатегория: ${product.subcategory}`,
//       product.color ? `Цвет: ${product.color}` : null,
//       `Цена: ${product.price}`,
//       `Семантическое описание: ${semantic.summary}`,
//       semantic.targetAudience.length > 0
//         ? `Целевая аудитория: ${semantic.targetAudience.join(', ')}`
//         : null,
//       semantic.styleAssociations.length > 0
//         ? `Стиль: ${semantic.styleAssociations.join(', ')}`
//         : null,
//       semantic.useCases.length > 0
//         ? `Сценарии использования: ${semantic.useCases.join(', ')}`
//         : null,
//       semantic.pricePositioning !== 'не удалось определить по имеющимся данным'
//         ? `Ценовое позиционирование: ${semantic.pricePositioning}`
//         : null,
//       semantic.searchTags.length > 0
//         ? `Поисковые формулировки: ${semantic.searchTags.join(', ')}`
//         : null,
//     ];

//     return lines.filter((line): line is string => line !== null).join('\n');
//   }

//   public async buildProductEmbeddingText(product: CreateProductEmbeddingText) {
//     return `
//       Название: ${product.title}
//       Описание: ${product.description}
//       Бренд: ${product.brand}
//       Категория: ${product.subcategory}
//       Цена: ${product.price}
//       `.trim();
//   }
// }

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai/client.js';
import { ChatOpenAI } from '@langchain/openai';

import { CreateProductEmbeddingText } from './dto/create-product-embedding-text.dto';
import { ProductSemanticInputDto } from './dto/product-semantic-input.dto';
import {
  ProductSemanticRepresentation,
  ProductSemanticRepresentationSchema,
} from './schemas/semantic-product-representation.schema';
import { productSemanticRepresentationPrompt } from './prompts/product-semantic-representation.prompt';

export type AiProvider = 'openai' | 'yandex';

const YANDEX_EMBEDDING_API_URL =
  'https://ai.api.cloud.yandex.net:443/foundationModels/v1/textEmbedding';

type YandexEmbeddingResponse = {
  embedding: Array<number | string>;
};

@Injectable()
export class AiService {
  private readonly openAiChatModel: ChatOpenAI;
  private readonly yandexChatModel: ChatOpenAI;
  private readonly yandexLiteChatModel: ChatOpenAI;

  public constructor(
    private readonly configService: ConfigService,
    private readonly openaiService: OpenAI,
  ) {
    this.openAiChatModel = new ChatOpenAI({
      apiKey: this.configService.getOrThrow<string>('OPENAI_API_KEY'),

      model:
        this.configService.get<string>('OPENAI_CHAT_MODEL') ?? 'gpt-4.1-mini',

      temperature: 0,
    });

    this.yandexChatModel = new ChatOpenAI({
      apiKey: this.configService.getOrThrow<string>('YANDEX_API_KEY'),

      model: this.configService.getOrThrow<string>('YANDEX_MODEL'),

      temperature: 0,

      configuration: {
        baseURL: this.configService.getOrThrow<string>('YANDEX_API_URL'),
      },

      streamUsage: false,

      // ИЗМЕНЕНО: retries LLM-вызовов support-agent контролирует LangGraph.
      maxRetries: 0,
    });

    this.yandexLiteChatModel = new ChatOpenAI({
      apiKey: this.configService.getOrThrow<string>('YANDEX_API_KEY'),

      model: this.configService.getOrThrow<string>('YANDEX_LITE_MODEL'),

      temperature: 0,

      configuration: {
        baseURL: this.configService.getOrThrow<string>('YANDEX_API_URL'),
      },

      streamUsage: false,

      maxRetries: 0,
    });
  }

  private getAiProvider(): AiProvider {
    const provider = this.configService.get<string>('AI_PROVIDER') ?? 'yandex';

    if (provider !== 'openai' && provider !== 'yandex') {
      throw new Error(
        `Неизвестный AI_PROVIDER: ${provider}. ` +
          'Ожидается "openai" или "yandex"',
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

  public getChatModel(provider?: AiProvider): ChatOpenAI {
    const activeProvider = provider ?? this.getAiProvider();

    if (activeProvider === 'openai') {
      return this.openAiChatModel;
    }

    return this.yandexChatModel;
  }

  public getYandexLiteChatModel(): ChatOpenAI {
    return this.yandexLiteChatModel;
  }

  public async createOpenAiEmbedding(text: string): Promise<number[]> {
    const response = await this.openaiService.embeddings.create({
      model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),

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

    const response = await this.openaiService.embeddings.create({
      model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),

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
    const apiKey = this.configService.getOrThrow<string>('YANDEX_API_KEY');

    const folderId = this.configService.getOrThrow<string>('YANDEX_FOLDER_ID');

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
    const modelUri = this.configService.getOrThrow<string>(
      'YANDEX_EMBEDDING_QUERY_MODEL',
    );

    return this.createYandexEmbedding(text, modelUri);
  }

  public async createYandexDocumentEmbedding(text: string): Promise<number[]> {
    const modelUri = this.configService.getOrThrow<string>(
      'YANDEX_EMBEDDING_DOCUMENT_MODEL',
    );

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
    const provider = this.getAiProvider();

    if (provider === 'openai') {
      return this.createOpenAiEmbedding(text);
    }

    return this.createYandexQueryEmbedding(text);
  }

  public async createDocumentEmbedding(text: string): Promise<number[]> {
    const provider = this.getAiProvider();

    if (provider === 'openai') {
      return this.createOpenAiEmbedding(text);
    }

    return this.createYandexDocumentEmbedding(text);
  }

  public async createDocumentEmbeddings(texts: string[]): Promise<number[][]> {
    const provider = this.getAiProvider();

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
    const model = this.getChatModel();

    // ИЗМЕНЕНО: убран диагностический explicit functionCalling.
    const structuredModel = model.withStructuredOutput(
      ProductSemanticRepresentationSchema,
      {
        name: 'create_product_semantic_representation',
      },
    );

    const prompt = await productSemanticRepresentationPrompt.invoke(product);

    return structuredModel.invoke(prompt);
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

      // START CHANGES — RAW DETAILS ДОБАВЛЕНЫ В SEARCH TEXT

      product.details.length > 0
        ? `Детали: ${product.details.join(', ')}`
        : null,

      // END CHANGES — RAW DETAILS ДОБАВЛЕНЫ В SEARCH TEXT

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
