import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';

import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { QdrantCollections } from '@/src/core/qdrant/qdrant.collections';
import {
  QDRANT_DENSE_VECTOR,
  QDRANT_SPARSE_VECTOR,
} from '@/src/core/qdrant/qdrant.constants';
import { QdrantService } from '@/src/core/qdrant/qdrant.service';
import { RerankerService } from '@/src/core/reranker/reranker.service';

import { StoreKnowledgeImportSchema } from './schemas/store-knowledge-import.schema';

const SEARCH_CANDIDATE_LIMIT = 20;
const SEARCH_RESULT_LIMIT = 1;

export type StoreKnowledgeSearchResult = {
  key: string;
  section: string;
  topic: string | null;
  question: string;
  answer: string;
  notice: string | null;
  footnote: string | null;
};

@Injectable()
export class StoreKnowledgeService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly aiService: AiService,
    private readonly qdrantService: QdrantService,
    private readonly rerankerService: RerankerService,
  ) {}

  async importJson(filePath: string): Promise<number> {
    const raw = await readFile(filePath, 'utf-8');
    const { items } = StoreKnowledgeImportSchema.parse(JSON.parse(raw));

    for (const [index, item] of items.entries()) {
      const knowledge = await this.prismaService.storeKnowledge.upsert({
        where: {
          key: item.id,
        },
        create: {
          key: item.id,
          section: item.category,
          topic: item.topic ?? null,
          question: item.question,
          answer: item.answer,
          notice: item.notice ?? null,
          footnote: item.footnote ?? null,
          tags: item.tags,
          sortOrder: index,
          isActive: true,
        },
        update: {
          section: item.category,
          topic: item.topic ?? null,
          question: item.question,
          answer: item.answer,
          notice: item.notice ?? null,
          footnote: item.footnote ?? null,
          tags: item.tags,
          sortOrder: index,
          isActive: true,
        },
      });

      const content = [
        `Вопрос: ${item.question}`,
        `Ответ: ${item.answer}`,
        item.notice ? `Важно: ${item.notice}` : null,
        item.footnote ? `Примечание: ${item.footnote}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      const embedding = await this.aiService.createDocumentEmbedding(content);

      await this.qdrantService.savePoint(QdrantCollections.storeKnowledge, {
        id: knowledge.id,
        vector: {
          [QDRANT_DENSE_VECTOR]: embedding,
          [QDRANT_SPARSE_VECTOR]: {
            text: content,
            model: 'qdrant/bm25',
          },
        },
        payload: {
          key: knowledge.key,
          section: knowledge.section,
          topic: knowledge.topic,
          question: knowledge.question,
          answer: knowledge.answer,
          notice: knowledge.notice,
          footnote: knowledge.footnote,
          content,
        },
      });
    }

    return items.length;
  }

  async findByKey(key: string): Promise<StoreKnowledgeSearchResult | null> {
    const knowledge = await this.prismaService.storeKnowledge.findFirst({
      where: {
        key,
        isActive: true,
      },
      select: {
        key: true,
        section: true,
        topic: true,
        question: true,
        answer: true,
        notice: true,
        footnote: true,
      },
    });

    return knowledge;
  }

  async findActiveKeys(keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) {
      return new Set();
    }

    const records = await this.prismaService.storeKnowledge.findMany({
      where: {
        key: {
          in: [...new Set(keys)],
        },
        isActive: true,
      },
      select: {
        key: true,
      },
    });

    return new Set(records.map((record) => record.key));
  }

  async search(query: string): Promise<StoreKnowledgeSearchResult | null> {
    const queryEmbedding = await this.aiService.createQueryEmbedding(query);

    const candidates = await this.qdrantService.hybridSearch(
      QdrantCollections.storeKnowledge,
      queryEmbedding,
      query,
      SEARCH_CANDIDATE_LIMIT,
    );

    const reranked = await this.rerankerService.rerank(
      query,
      candidates,
      (candidate) => String(candidate.payload?.content ?? ''),
      SEARCH_RESULT_LIMIT,
    );

    const bestResult = reranked[0];

    if (!bestResult) {
      return null;
    }

    const payload = bestResult.item.payload;

    if (!payload) {
      throw new Error('StoreKnowledgeService: у найденного point нет payload');
    }

    return {
      key: String(payload.key),
      section: String(payload.section),
      topic: payload.topic ? String(payload.topic) : null,
      question: String(payload.question),
      answer: String(payload.answer),
      notice: payload.notice ? String(payload.notice) : null,
      footnote: payload.footnote ? String(payload.footnote) : null,
    };
  }
}
