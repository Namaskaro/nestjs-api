import { describe, expect, it, jest } from '@jest/globals';

import type { AiService } from '@/src/ai/ai.service';

import type { ProductConsultationLlmContext } from '../context/product-consultation-context';

import type { ProductConsultantRoundObservation } from '../consultant/product-consultant-model.port';

import { createProductRecommendationSynthesizer } from './product-recommendation-synthesizer';

function context(): ProductConsultationLlmContext {
  return {
    version: 1,

    currentMessage: 'Nike Mind 002 подойдёт для ежедневной ходьбы?',

    recentMessages: [],

    task: null,

    searchCapabilities: null,

    results: {
      status: 'active',

      hasLastConfirmed: true,

      shownProducts: [
        {
          position: 2,

          title: 'Nike Mind 002',

          price: '23000',

          image: null,
        },
      ],
    },

    productFacts: [
      {
        position: 2,

        title: 'Nike Mind 002',

        description: 'Описание товара из каталога.',

        profileId: 'SHOES',

        facts: [],
      },
    ],

    semanticEvidence: [],

    comparison: null,

    profile: null,

    usage: null,
  };
}

const observation: ProductConsultantRoundObservation = {
  kind: 'recommend',

  status: 'context_ready',
};

function aiServiceReturning(response: unknown) {
  const invoke = jest.fn(async () => response);

  const withStructuredOutput = jest.fn(
    (
      _schema: unknown,

      _options: unknown,
    ) => ({
      invoke,
    }),
  );

  const model = {
    withStructuredOutput,
  };

  return {
    aiService: {
      getChatModel: () => model,
    } as unknown as AiService,

    invoke,

    withStructuredOutput,
  };
}

describe('ProductRecommendationSynthesizer', () => {
  it('uses JSON mode for Yandex recommendation synthesis', async () => {
    const ai = aiServiceReturning({
      message: 'Nike Mind 002 можно рассматривать для ежедневной ходьбы.',

      recommendedPosition: null,
    });

    const synthesizer = createProductRecommendationSynthesizer(ai.aiService);

    const result = await synthesizer.synthesize({
      context: context(),

      observation,
    });

    expect(ai.withStructuredOutput).toHaveBeenCalledTimes(1);

    expect(ai.withStructuredOutput.mock.calls[0][1]).toEqual({
      name: 'product_recommendation_response',

      method: 'jsonMode',
    });

    expect(result).toEqual({
      message: 'Nike Mind 002 можно рассматривать для ежедневной ходьбы.',

      recommendedPosition: null,
    });
  });

  it('accepts the original result position for a multi-product recommendation', async () => {
    const ai = aiServiceReturning({
      message: 'Для вечернего мероприятия я бы выбрал второй вариант.',

      recommendedPosition: 2,
    });

    const synthesizer = createProductRecommendationSynthesizer(ai.aiService);

    const result = await synthesizer.synthesize({
      context: context(),

      observation,
    });

    expect(result).toEqual({
      message: 'Для вечернего мероприятия я бы выбрал второй вариант.',

      recommendedPosition: 2,
    });
  });

  it('rejects malformed recommendation output', async () => {
    const ai = aiServiceReturning({
      text: 'Обычный текст вместо контракта.',
    });

    const synthesizer = createProductRecommendationSynthesizer(ai.aiService);

    await expect(
      synthesizer.synthesize({
        context: context(),

        observation,
      }),
    ).rejects.toThrow();
  });
});
