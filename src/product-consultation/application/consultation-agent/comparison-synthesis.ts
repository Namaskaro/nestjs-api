import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { AiService } from '@/src/ai/ai.service';

import {
  ComparisonSynthesisInputSchema,
  ComparisonSynthesisOutputSchema,
  type ComparisonSynthesisInput,
  type ComparisonSynthesisOutput,
} from '@/src/product-consultation/application/presentation/comparison-presentation.schema';

import { comparisonSynthesisPrompt } from './prompts/comparison-synthesis.prompt';

const COMPARISON_SYNTHESIS_TIMEOUT_MS = 12_000;

export function createComparisonSynthesis(aiService: AiService) {
  const model = aiService
    .getYandexLiteChatModel()
    .withStructuredOutput(ComparisonSynthesisOutputSchema, {
      name: 'summarize_product_comparison',
      includeRaw: true,
    });

  return {
    async summarizeComparison(
      rawInput: ComparisonSynthesisInput,
    ): Promise<ComparisonSynthesisOutput | null> {
      const input = ComparisonSynthesisInputSchema.parse(rawInput);

      if (!input.keyDifferences.length) {
        return null;
      }

      try {
        const response = await model.invoke(
          [
            new SystemMessage(comparisonSynthesisPrompt),

            new HumanMessage(JSON.stringify(input)),
          ],
          {
            signal: AbortSignal.timeout(COMPARISON_SYNTHESIS_TIMEOUT_MS),
          },
        );

        const parsed = ComparisonSynthesisOutputSchema.safeParse(
          response.parsed,
        );

        if (!parsed.success) {
          return null;
        }

        if (
          parsed.data.preferredPosition !== null &&
          !input.products.some(
            (product) => product.position === parsed.data.preferredPosition,
          )
        ) {
          return null;
        }

        return parsed.data;
      } catch {
        return null;
      }
    },
  };
}

export type ComparisonSynthesis = ReturnType<typeof createComparisonSynthesis>;
