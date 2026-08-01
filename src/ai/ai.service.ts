import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai/client.js';
import { ChatOpenAI } from '@langchain/openai';
import { CreateProductEmbeddingText } from './dto/create-product-embedding-text.dto';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../core/prisma/prisma.service';
import { join } from 'node:path';
import { ProductSemanticInputDto } from './dto/product-semantic-input.dto';
import {
  ProductSemanticRepresentation,
  ProductSemanticRepresentationSchema,
} from './schemas/semantic-product-representation.schema';
import { productSemanticRepresentationPrompt } from './prompts/product-semantic-representation.prompt';

export type AiChatProvider = 'openai' | 'yandex';
export type FaqChunks = {
  id: string;
  section: string;
  question: string;
  answer: string;
  content: string;
};

@Injectable()
export class AiService {
  private readonly openAiChatModel: ChatOpenAI;
  private readonly yandexChatModel: ChatOpenAI;
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly openaiService: OpenAI,
    @Inject('YandexGPT')
    private readonly yandexgptService: OpenAI, // private readonly openAiChatModel: ChatOpenAI, // private readonly yandexChatModel: ChatOpenAI,
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
    });
  }

  public getChatModel(provider: AiChatProvider = 'yandex'): ChatOpenAI {
    if (provider === 'openai') {
      return this.openAiChatModel;
    }

    return this.yandexChatModel;
  }

  async createEmbedding(text: string) {
    const response = await this.openaiService.embeddings.create({
      model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),
      input: text,
      dimensions: 1536,
    });
    return response.data[0].embedding;
  }

  async createEmbeddings(text: string | string[]) {
    const response = await this.openaiService.embeddings.create({
      model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),
      input: text,
      dimensions: 1536,
    });

    const embeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    if (typeof text === 'string') {
      return embeddings[0];
    }

    return embeddings;
  }

  async createProductEmbedding(text: string) {
    const response = await this.openaiService.embeddings.create({
      model: this.configService.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),
      input: text,
      dimensions: 1536,
    });

    return response.data[0].embedding;
  }

  async createProductSemanticRepresentation(
    product: ProductSemanticInputDto,
  ): Promise<ProductSemanticRepresentation> {
    const model = this.getChatModel('yandex');

    const structuredModel = model.withStructuredOutput(
      ProductSemanticRepresentationSchema,
      {
        name: 'create_product_semantic_representation',
      },
    );

    const prompt = await productSemanticRepresentationPrompt.invoke(product);

    return structuredModel.invoke(prompt);
  }

  buildProductSearchText(
    product: ProductSemanticInputDto,
    semantic: ProductSemanticRepresentation,
  ): string {
    return [
      `Название: ${product.title}`,
      `Описание: ${product.description}`,
      `Бренд: ${product.brand}`,
      `Категория: ${product.category}`,
      `Подкатегория: ${product.category}`,
      `Цвет: ${product.color}`,
      `Цена: ${product.price}`,

      `Семантическое описание: ${semantic.summary}`,

      `Целевая аудитория: ${semantic.targetAudience.join(', ')}`,

      `Стиль: ${semantic.styleAssociations.join(', ')}`,

      `Сценарии использования: ${semantic.useCases.join(', ')}`,

      `Ценовое позиционирование: ${semantic.pricePositioning}`,

      `Поисковые формулировки: ${semantic.searchTags.join(', ')}`,
    ].join('\n');
  }

  async buildProductEmbeddingText(product: CreateProductEmbeddingText) {
    return `
      Название: ${product.title}
      Описание: ${product.description}
      Бренд: ${product.brand}
      Категория: ${product.subcategory}
      Цена: ${product.price}
      `.trim();
  }

  async loadFaqChunks(filePath: string) {
    const file = await readFile(filePath, 'utf-8');

    const chunks = JSON.parse(file) as FaqChunks[];

    if (!Array.isArray(chunks)) {
      throw new Error('FAQ JSON должен содержать массив');
    }

    return chunks;
  }

  async createFaqEmbeddings(chunks: FaqChunks[]) {
    const texts = chunks.map((chunk) => chunk.content);

    const embeddings = await this.createEmbeddings(texts);

    return chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index],
    }));
  }

  async saveFaqEmbeddingsToDB() {
    const filePath = join(process.cwd(), 'data', 'faq_chunks.json');
    const chunks = await this.loadFaqChunks(filePath);

    const embeddedChunks = await this.createFaqEmbeddings(chunks);

    for (const item of embeddedChunks) {
      await this.prismaService.$executeRaw`
    INSERT INTO "FaqKnowledge"
      ("id", "section", "question", "answer", "content", "embedding")
    VALUES (
      ${item.id},
      ${item.section},
      ${item.question},
      ${item.answer},
      ${item.content},
      ${item.embedding}::vector
    )
  `;
    }

    return {
      message: 'Данные успешно сохранены',
    };
  }
}
