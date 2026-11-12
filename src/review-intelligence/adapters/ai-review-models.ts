import type { ConfigService } from '@nestjs/config';
import type { AiService } from '@/src/ai/ai.service';
import { embeddingSpace } from '@/src/ai/embedding-execution';
import type { ReviewEmbeddings, ReviewTextModels } from '../application/ports';

export class AiReviewModels implements ReviewTextModels, ReviewEmbeddings {
  constructor(
    private readonly ai: AiService,
    private readonly config?: ConfigService,
  ) {}

  open(...[task, schema, metadata]: Parameters<ReviewTextModels['open']>) {
    const model = this.ai.getChatModel('STANDARD');
    const structured = model.withStructuredOutput(schema, {
      name: task,
      method: 'jsonMode',
    });
    return {
      countTokens: (text: string) => model.getNumTokens(text),
      invoke: (
        messages: Parameters<ReturnType<ReviewTextModels['open']>['invoke']>[0],
        signal?: AbortSignal,
      ) =>
        structured.invoke(messages, {
          signal,
          runName: task,
          tags: ['reviews'],
          ...(metadata ? { metadata } : {}),
        }),
    };
  }

  space() {
    const provider = this.config?.get<string>('EMBEDDING_PROVIDER');
    if (provider !== 'yandex' && provider !== 'openai')
      throw new Error(
        'Review index requires configured primary embedding provider',
      );
    const spec = this.ai.getEmbeddingSpec(provider);
    return { dimensions: spec.dimensions, version: embeddingSpace(spec) };
  }

  embedQuery(text: string, signal?: AbortSignal) {
    return this.ai.createQueryEmbedding(text, { signal });
  }

  embedDocument(text: string, signal: AbortSignal) {
    return this.ai.createDocumentEmbedding(text, { signal });
  }
}
