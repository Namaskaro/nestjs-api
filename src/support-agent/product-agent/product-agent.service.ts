// import { AiService } from '@/src/ai/ai.service';
// import { ProductItem } from './schemas/product-agent-result.schema';
// import { CohereClientV2 } from 'cohere-ai';
// import { SupportAgentGraph } from '../graph/support-agent.graph';
// import { ClarificationResumeValue } from '../schemas/cclarification-resume.schema';

// export class ProductAgentService {
//   constructor(
//     private readonly aiService: AiService,
//     private readonly client: CohereClientV2,
//     private readonly model: string,
//     private readonly supportAgentGraph: SupportAgentGraph,
//   ) {
//     const apiKey = process.env.COHERE_API_KEY;

//     if (!apiKey) {
//       throw new Error(
//         'CohereRerankService: переменная COHERE_API_KEY не определена',
//       );
//     }

//     this.model = process.env.COHERE_RERANK_MODEL ?? 'rerank-v4.0-pro';

//     this.client = new CohereClientV2({
//       token: apiKey,
//     });
//   }

//   invoke(query: string, threadId: string) {
//     return this.supportAgentGraph.invoke(query, threadId);
//   }

//   resume(value: ClarificationResumeValue, threadId: string) {
//     return this.supportAgentGraph.resume(value, threadId);
//   }

//   private async rerankSearchResults(
//     query: string,
//     documents: string[],
//     topN: number,
//   ) {
//     if (documents.length === 0) {
//       return [];
//     }

//     const response = await this.client.rerank({
//       model: this.model,
//       query,
//       documents,

//       /**
//        * Нельзя запросить больше результатов,
//        * чем документов было передано.
//        */
//       topN: Math.min(topN, documents.length),
//     });

//     return response.results.map((result) => ({
//       index: result.index,
//       score: result.relevanceScore,
//     }));
//   }

//   // public async hybridProductSearch(query: string): Promise<ProductItem[]> {}
// }

import { Injectable } from '@nestjs/common';

import { AiService } from '@/src/ai/ai.service';

import { CohereClientV2 } from 'cohere-ai';

import type { ProductItem } from './schemas/product-agent-result.schema';

@Injectable()
export class ProductAgentService {
  private readonly client: CohereClientV2;

  private readonly model: string;

  constructor(private readonly aiService: AiService) {
    const apiKey = process.env.COHERE_API_KEY;

    if (!apiKey) {
      throw new Error(
        'ProductAgentService: переменная COHERE_API_KEY не определена',
      );
    }

    this.model = process.env.COHERE_RERANK_MODEL ?? 'rerank-v4.0-pro';

    this.client = new CohereClientV2({
      token: apiKey,
    });
  }

  /**
   * Здесь должен находиться полный pipeline:
   *
   * 1. embedding запроса;
   * 2. dense search;
   * 3. sparse/BM25 search;
   * 4. fusion;
   * 5. rerank;
   * 6. преобразование результата в ProductItem[].
   */
  public async hybridProductSearch(query: string): Promise<ProductItem[]> {
    /**
     * Временная заглушка.
     *
     * Замени её реализацией поиска,
     * когда будем подключать Qdrant.
     */
    void query;
    void this.aiService;

    throw new Error(
      'ProductAgentService.hybridProductSearch пока не реализован',
    );
  }

  private async rerankSearchResults(
    query: string,
    documents: string[],
    topN: number,
  ) {
    if (documents.length === 0) {
      return [];
    }

    const response = await this.client.rerank({
      model: this.model,

      query,

      documents,

      topN: Math.min(topN, documents.length),
    });

    return response.results.map((result) => ({
      index: result.index,

      score: result.relevanceScore,
    }));
  }
}
