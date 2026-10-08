import { z } from 'zod';

import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { AiService } from '@/src/ai/ai.service';

import type { ProductConsultationLlmContext } from '../context/product-consultation-context';

import type { ProductConsultantRoundObservation } from '../consultant/product-consultant-model.port';

export const ProductRecommendationSynthesisSchema = z
  .object({
    message: z.string().trim().min(1).max(2400),

    recommendedPosition: z
      .number()
      .int()
      .min(1)
      .max(25)
      .nullable()
      .default(null),
  })
  .strict();

export type ProductRecommendationSynthesis = z.infer<
  typeof ProductRecommendationSynthesisSchema
>;

const PRODUCT_RECOMMENDATION_PROMPT = `
Ты — консультант интернет-магазина.

Пользователь уже выбрал один или несколько конкретных товаров.
Backend передал подтверждённые данные о них.

Верни только JSON-объект следующей формы:

{
  "message": "текст ответа пользователю",
  "recommendedPosition": null
}

или:

{
  "message": "текст ответа пользователю",
  "recommendedPosition": 2
}

Никакого текста до JSON.
Никакого текста после JSON.
Никакого Markdown.
Никаких code fences.

Правила выбора:

Если context.productFacts содержит ровно один товар:

1. Не выбирай товар повторно.
2. Ответь, насколько именно этот товар подходит под запрос пользователя.
3. recommendedPosition всегда null.

Backend уже детерминированно выбрал нужный товар.

Если context.productFacts содержит несколько товаров:

1. Выбери ровно один товар.
2. Объясни выбор естественным человеческим языком.
3. recommendedPosition должен точно совпадать
   со значением position выбранного товара
   из context.productFacts.

Не перенумеровывай товары самостоятельно.

Например:

context.productFacts:
[
  {
    "position": 2,
    "title": "Nike Mind 002"
  }
]

Тогда:

recommendedPosition=null

потому что backend уже выбрал единственный товар.

Другой пример:

context.productFacts:
[
  {
    "position": 1,
    "title": "Satin Draped Maxi Dress"
  },
  {
    "position": 2,
    "title": "Bias-cut Evening Gown"
  }
]

Если выбираешь Bias-cut Evening Gown:

recommendedPosition=2

Используй только данные из context:

currentMessage
task Memory
productFacts
catalog description
semanticEvidence
usage

productFacts и catalog description —
основные подтверждённые источники.

semanticEvidence —
дополнительная интерпретация каталожных данных.

Не придумывай отсутствующие характеристики.

Не делай вывод о качестве только из бренда или цены.

Не обещай индивидуальный комфорт,
если данных для такого обещания нет.

Если данных недостаточно для уверенного утверждения,
скажи об этом естественным языком.

Ответ должен звучать как нормальная консультация человеку.

Не употребляй во внешнем тексте:

"сценарий"
"semantic"
"evidence"
"по описанию"
"целевая аудитория"
"атрибут"
"критерий модели"
"позиция товара"

Вместо технических формулировок говори естественно:

"для повседневной носки"
"для вечернего мероприятия"
"для долгой ходьбы"
"если хочется более спокойный образ"
"если важнее..."

Не используй Markdown.

Не используй символы:

**
###
*
__

Не добавляй заголовок "Рекомендация".
Frontend покажет его сам.

Не перечисляй все характеристики подряд.
Объясни только то,
что действительно связано с вопросом пользователя.

Поле message содержит только человеческий ответ пользователю.
`.trim();

export function createProductRecommendationSynthesizer(aiService: AiService) {
  const model = aiService
    .getChatModel('yandex')
    .withStructuredOutput(ProductRecommendationSynthesisSchema, {
      name: 'product_recommendation_response',

      method: 'jsonMode',
    });

  return {
    async synthesize(input: {
      context: ProductConsultationLlmContext;

      observation: ProductConsultantRoundObservation;

      signal?: AbortSignal;
    }): Promise<ProductRecommendationSynthesis> {
      const response = await model.invoke(
        [
          new SystemMessage(PRODUCT_RECOMMENDATION_PROMPT),

          new HumanMessage(
            JSON.stringify({
              observation: input.observation,

              context: input.context,
            }),
          ),
        ],
        {
          signal: input.signal,
        },
      );

      return ProductRecommendationSynthesisSchema.parse(response);
    },
  };
}
