import type { AiService } from '@/src/ai/ai.service';
import { AiReviewModels } from '@/src/review-intelligence/adapters/ai-review-models';
import { answerProductReviewQuestion as answer } from '@/src/review-intelligence/application/review-answer';
import type { ProductAgentService } from '../agent/product-agent.service';
import type { ProductReviewAnswer } from '../presentation/product-presentation.schema';

export function answerProductReviewQuestion(
  ai: AiService,
  products: ProductAgentService,
  input: { productId: string; query: string; signal?: AbortSignal },
): Promise<ProductReviewAnswer> {
  return answer(
    new AiReviewModels(ai),
    {
      search: (id, query, signal) => products.searchReviews(id, query, signal),
      resolveSources: (id, refs) => products.resolveReviewSources(id, refs),
    },
    input,
  );
}
