const { AIMessage } = require('@langchain/core/messages');
const {
  BaseChatModel,
} = require('@langchain/core/language_models/chat_models');
const { RunnableLambda } = require('@langchain/core/runnables');

const spec = {
  provider: 'yandex',
  queryModel: 'review-live-query',
  documentModel: 'review-live-document',
  dimensions: 768,
};
const vector = Array.from({ length: spec.dimensions }, (_, index) =>
  Number(index === 0),
);
const prompts = {
  search: 'Подбери кроссовки для прогулок',
  details: 'Покажи отзывы о первом товаре. Удобно ли ходить?',
  compare: 'Сравни товары 1 и 2',
  recommend: 'Порекомендуй товар 1 или 2 с учётом отзывов',
};

function content(input) {
  const messages = Array.isArray(input) ? input : input.toChatMessages();
  return String(messages.at(-1).content);
}

function workspace(query) {
  const lower = query.toLowerCase();
  const position = Number(
    lower.match(/\b([1-3])\b/)?.[1] ??
      (/втор/.test(lower) ? 2 : /треть/.test(lower) ? 3 : 1),
  );
  const action = /сравн/.test(lower)
    ? 'COMPARE'
    : /порекоменд|выбери/.test(lower)
    ? 'RECOMMEND'
    : /отзыв|впечатлен|удобно ли|подробн|характеристик/.test(lower)
    ? 'DETAILS'
    : 'SEARCH';
  const decision =
    action === 'SEARCH'
      ? {
          action,
          search: { semanticIntent: query, category: 'SHOES', constraints: [] },
        }
      : {
          action,
          selection: {
            kind: 'positions',
            positions:
              action === 'DETAILS' ||
              (action === 'RECOMMEND' && /товар [1-3] для/.test(lower))
                ? [position]
                : [1, 2],
          },
          factAttributeIds: ['price'],
          ...(action === 'DETAILS' && /отзыв|впечатлен|удобно ли/.test(lower)
            ? { reviewQuery: query }
            : {}),
        };
  return {
    operations: [
      {
        kind: 'consult',
        query,
        target:
          action === 'SEARCH'
            ? { kind: 'new' }
            : { kind: 'current', view: 'results' },
        actions: [{ decision }],
      },
    ],
    clarification: null,
  };
}

class ReviewLiveModel extends BaseChatModel {
  _llmType() {
    return 'review-live-deterministic';
  }
  bindTools() {
    return this;
  }
  async getNumTokens(text) {
    return Math.ceil(text.length / 4);
  }
  async _generate() {
    const text =
      'Тестовый консультант. Подберите кроссовки, затем выберите товар для отзыва или сравнения.';
    return { generations: [{ text, message: new AIMessage(text) }] };
  }
  withStructuredOutput(schema, { name, includeRaw } = {}) {
    return RunnableLambda.from(async (input) => {
      let value;
      switch (name) {
        case 'route_support_request':
          value = {
            workerQueries: {
              productAgent: content(input)
                .split('Текущий запрос:')
                .at(-1)
                .trim(),
              orderAgent: null,
              customerHelpAgent: null,
            },
            orderRequest: null,
            fallbackRoute: null,
            clarificationTopic: null,
            handoffRequest: null,
            reason: 'Сценарий тестового каталога',
          };
          break;
        case 'product_workspace_decision':
          value = workspace(JSON.parse(content(input)).currentMessage);
          break;
        case 'review_summary':
          value = {
            positiveImpressions: [
              'В тестовом корпусе отмечают удобство ходьбы.',
            ],
            negativeImpressions: [
              'В отдельных отзывах упоминают плотную посадку.',
            ],
            summary:
              'Покупатели описывают мягкую подошву и удобство на прогулках. Посадка может ощущаться плотной.',
          };
          break;
        case 'product_review_answer': {
          const { sources } = JSON.parse(content(input));
          const other =
            sources.find((entry) => entry.text !== sources[0].text) ??
            sources[1];
          value = {
            message:
              `Об удобстве покупатели пишут так: «${sources[0].text.slice(
                0,
                220,
              )}».` +
              (other && other.text !== sources[0].text
                ? ` Другой опыт: «${other.text.slice(0, 180)}».`
                : ''),
            usedPositions: other
              ? [sources[0].position, other.position]
              : [sources[0].position],
          };
          break;
        }
        case 'product_recommendation_response': {
          const { context } = JSON.parse(content(input));
          const price = (product) => {
            const fact = product.facts.find(
              ({ attributeId, status }) =>
                attributeId === 'price' && status === 'known',
            );
            return typeof fact?.value === 'number' ? fact.value : Infinity;
          };
          const sorted = [...context.productFacts].sort(
            (a, b) => price(a) - price(b),
          );
          const [best, other] = sorted;
          const difference =
            other && Number.isFinite(price(other)) && price(best) < price(other)
              ? ` Из этих вариантов он дешевле, чем «${other.title}».`
              : other
              ? ' По подтверждённым данным различия для прогулок ограничены.'
              : '';
          value = {
            recommendedPosition: other ? best.position : null,
            message: `Для прогулок рекомендую «${best.title}»: ${
              best.description.split('.')[0]
            }.${difference}`,
          };
          break;
        }
        default:
          throw new Error(`Review live AI has no scenario for ${name}`);
      }
      const parsed = schema.parse(value);
      return includeRaw
        ? { parsed, raw: new AIMessage(JSON.stringify(value)) }
        : parsed;
    });
  }
}

function createAi() {
  if (process.env.REVIEW_LIVE_AI_MODE !== 'deterministic')
    throw new Error('An approved provider profile is required to switch AI');
  const model = new ReviewLiveModel({});
  return {
    embeddingFailover: false,
    getChatModel: () => model,
    getEmbeddingSpec: () => spec,
    createDocumentEmbedding: async () => vector,
    createQueryEmbedding: async () => vector,
  };
}

const reranker = {
  async rerank(_query, candidates, _text, limit) {
    return [...candidates]
      .sort((a, b) => a.product.title.localeCompare(b.product.title, 'ru'))
      .slice(0, limit)
      .map((item) => ({ item, score: 0.5 }));
  },
};

module.exports = { createAi, prompts, reranker, spec, vector };
