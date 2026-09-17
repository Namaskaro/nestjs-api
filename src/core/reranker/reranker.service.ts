import { Injectable, Logger } from '@nestjs/common';

const RERANKER_MODEL = 'onnx-community/bge-reranker-v2-m3-ONNX';
const RERANKER_DTYPE = 'int8';
const DEFAULT_CACHE_DIR = './.cache/reranker';
const MAX_SEQUENCE_LENGTH = 512;

type TransformersModule = typeof import('@huggingface/transformers', {
  with: {
    'resolution-mode': 'import',
  }
});

const importTransformers = new Function(
  "return import('@huggingface/transformers')",
) as () => Promise<TransformersModule>;

type RerankItem<T> = {
  item: T;
  score: number;
};

type TransformersRuntime = {
  tokenizer: (
    text: string[],
    options: {
      text_pair: string[];
      padding: boolean;
      truncation: boolean;
      max_length: number;
    },
  ) => Promise<Record<string, unknown>>;

  model: (inputs: Record<string, unknown>) => Promise<{
    logits: {
      data: ArrayLike<number>;
    };
  }>;
};

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);

  private runtimePromise: Promise<TransformersRuntime> | null = null;

  async rerank<T>(
    query: string,
    items: T[],
    getDocument: (item: T) => string,
    topK = 5,
  ): Promise<RerankItem<T>[]> {
    if (items.length === 0) {
      return [];
    }

    const { tokenizer, model } = await this.getRuntime();

    const documents = items.map(getDocument);
    const queries = documents.map(() => query);

    const inputs = await tokenizer(queries, {
      text_pair: documents,
      padding: true,
      truncation: true,
      max_length: MAX_SEQUENCE_LENGTH,
    });

    const { logits } = await model(inputs);

    const rawScores = Array.from(logits.data, Number);

    if (rawScores.length !== items.length) {
      throw new Error(
        `RerankerService: модель вернула ${rawScores.length} scores для ${items.length} кандидатов`,
      );
    }

    return items
      .map((item, index) => ({
        item,
        score: 1 / (1 + Math.exp(-rawScores[index])),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(topK, items.length));
  }

  private getRuntime(): Promise<TransformersRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = this.loadRuntime().catch((error) => {
        this.runtimePromise = null;

        throw error;
      });
    }

    return this.runtimePromise;
  }

  private async loadRuntime(): Promise<TransformersRuntime> {
    this.logger.log(`Загрузка локального reranker: ${RERANKER_MODEL}`);

    const { AutoModelForSequenceClassification, AutoTokenizer, env } =
      await importTransformers();

    env.cacheDir = process.env.RERANKER_CACHE_DIR ?? DEFAULT_CACHE_DIR;

    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(RERANKER_MODEL),

      AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
        dtype: RERANKER_DTYPE,
      }),
    ]);

    this.logger.log(
      `Локальный reranker загружен. cacheDir=${env.cacheDir}, dtype=${RERANKER_DTYPE}`,
    );

    return {
      tokenizer: tokenizer as unknown as TransformersRuntime['tokenizer'],

      model: model as unknown as TransformersRuntime['model'],
    };
  }
}