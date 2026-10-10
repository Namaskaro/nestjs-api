import { describe, expect, it, jest } from '@jest/globals';

import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { AiService } from '@/src/ai/ai.service';

import type { ProductAgentService } from '../../product-agent.service';

import type { ProductTaskExecutionInput } from '../execute-product-decision.node';

import { createExecuteProductDecisionNode } from '../execute-product-decision.node';

import {
  ProductConsultantDecisionSchema,
  type ProductConsultantDecision,
} from '../../../consultant/product-consultant-decision.schema';

import {
  ConsultationApplicationRecordSchema,
  createConsultationApplicationRecord,
  type ConsultationApplicationRecord,
} from '../../../runtime/consultation-application-record';

import type { ProductDetails } from '../../../../core/consultation-core.schema';

import {
  beginSearchExecution,
  commitSearchExecution,
} from '../../../../core/results/consultation-results';

import type { ConsultationResultProduct } from '../../../../core/results/consultation-results.schema';

import { createSearchSpec } from '../../../../core/search/search-spec';

import type { SearchSpec } from '../../../../core/search/search-spec.schema';

import { createProductConsultationState } from '../../../../core/state/consultation-state';

const nodeConfig = {} as LangGraphRunnableConfig;

function adidasSearch() {
  return createSearchSpec({
    semanticIntent: 'мужские кроссовки Adidas',

    category: 'SHOES',

    constraints: [
      {
        attributeId: 'gender',

        operator: 'eq',

        value: 'MAN',

        unit: null,
      },

      {
        attributeId: 'brand',

        operator: 'eq',

        value: 'Adidas',

        unit: null,
      },
    ],
  });
}

function searchProducts(): ConsultationResultProduct[] {
  return [
    {
      productId: 'adidas-1',

      title: 'HANDBALL SPEZIAL SHOES',

      price: '12500',

      image: null,
    },

    {
      productId: 'adidas-2',

      title: 'Campus 00s',

      price: '12800',

      image: null,
    },
  ];
}

function productDetails(input: {
  id: string;

  title: string;

  price: number;
}): ProductDetails {
  const observedAt = '2026-10-01T00:00:00.000Z';

  return {
    id: input.id,

    title: input.title,

    description: `${input.title} catalog description`,

    productType: 'SHOES',

    profileId: 'SHOES',

    price: String(input.price),

    currency: 'RUB',

    discount: null,

    images: [],

    availability: {
      inStock: true,

      stock: 5,
    },

    brand: {
      id: 'brand-adidas',

      name: 'Adidas',
    },

    category: null,

    subcategory: null,

    attributes: [
      {
        attributeId: 'price',

        kind: 'number',

        unit: null,

        status: 'known',

        value: input.price,

        displayValue: `${input.price} ₽`,

        provenance: [
          {
            sourceId: 'current-store',

            recordId: input.id,

            observedAt,

            updatedAt: null,

            paths: ['price'],

            transformation: null,
          },
        ],
      },
    ],

    source: {
      sourceId: 'current-store',

      recordId: input.id,

      observedAt,

      updatedAt: null,
    },
  };
}

function allProductDetails(): ProductDetails[] {
  return [
    productDetails({
      id: 'adidas-1',

      title: 'HANDBALL SPEZIAL SHOES',

      price: 12500,
    }),

    productDetails({
      id: 'adidas-2',

      title: 'Campus 00s',

      price: 12800,
    }),
  ];
}

function activeRecord(): ConsultationApplicationRecord {
  const base = createConsultationApplicationRecord();

  const search = adidasSearch();

  const state = createProductConsultationState(search);

  const started = beginSearchExecution(
    base.results,

    search,

    () => 'execution-adidas',
  );

  const results = commitSearchExecution(
    started.state,

    started.executionId,

    searchProducts(),

    () => 'result-adidas',
  );

  return ConsultationApplicationRecordSchema.parse({
    ...base,

    revision: 1,

    generation: 1,

    state,

    results,
  });
}

function capabilityDecision(input: {
  action: 'DETAILS' | 'COMPARE' | 'RECOMMEND';

  positions: number[];
}): ProductConsultantDecision {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action: input.action,

      taskTransition: 'continue',

      search: null,

      searchPatch: null,

      memoryObservations: [],

      selection: {
        kind: 'positions',

        positions: input.positions,
      },

      feedback: null,
    },

    usageScenarioIds: [],

    factAttributeIds: ['price'],

    terminalText: null,
  });
}

function searchDecision(): ProductConsultantDecision {
  const search = adidasSearch();

  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action: 'SEARCH',

      taskTransition: 'start_new',

      search: {
        semanticIntent: search.semanticIntent,

        category: search.category,

        constraints: search.constraints,
      },

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: null,
  });
}

function agentState(input: {
  query: string;

  requestId: string;

  record: ConsultationApplicationRecord;

  decision: ProductConsultantDecision;
}): ProductTaskExecutionInput {
  return {
    query: input.query,

    conversationId: 'conversation-semantic-enrichment',

    requestId: input.requestId,

    recentMessages: [],

    consultationRecord: input.record,

    decision: input.decision,
  };
}

function createAiService() {
  const recommendationInvoke = jest.fn(
    async (_messages: unknown, _config?: unknown) => ({
      message: 'Для этой задачи лучше подходит Campus 00s.',

      recommendedPosition: 2,
    }),
  );

  const model = {
    withStructuredOutput: jest.fn(() => ({
      invoke: recommendationInvoke,
    })),
  };

  const aiService = {
    getChatModel: () => model,
  } as unknown as AiService;

  return {
    aiService,

    recommendationInvoke,
  };
}

function recommendationPayload(
  recommendationInvoke: ReturnType<
    typeof createAiService
  >['recommendationInvoke'],
) {
  const responseCall = recommendationInvoke.mock.calls[0];

  const messages = responseCall?.[0] as Array<{
    content: unknown;
  }>;

  return JSON.parse(String(messages[1]?.content)) as {
    context: {
      semanticEvidence: unknown[];

      productFacts: unknown[];
    };
  };
}

function createProductAgentService() {
  const products = allProductDetails();

  const validate = jest.fn((_search: SearchSpec) => undefined);

  const search = jest.fn(
    async (_search: SearchSpec): Promise<ConsultationResultProduct[]> =>
      searchProducts(),
  );

  const getProductDetails = jest.fn(
    async (productIds: readonly string[]): Promise<ProductDetails[]> => {
      const byId = new Map(
        products.map((product) => [product.id, product] as const),
      );

      return productIds.flatMap((productId) => {
        const product = byId.get(productId);

        return product ? [structuredClone(product)] : [];
      });
    },
  );

  const getProductSemanticRepresentations = jest.fn(
    async (productIds: readonly string[]) =>
      new Map(
        productIds.map((productId) => [
          productId,

          {
            summary:
              productId === 'adidas-1'
                ? 'Ретро-модель для повседневных городских образов.'
                : 'Повседневная городская модель в casual-стилистике.',

            targetAudience: ['Покупатели повседневной городской обуви'],

            styleAssociations: ['casual', 'retro'],

            useCases: ['повседневная носка', 'городские прогулки'],

            pricePositioning: 'средний ценовой сегмент',

            searchTags: [`internal-search-tag-${productId}`],
          },
        ]),
      ),
  );

  const service = {
    validate,

    search,

    getProductDetails,

    getProductSemanticRepresentations,
  } as unknown as ProductAgentService;

  return {
    service,

    validate,

    search,

    getProductDetails,

    getProductSemanticRepresentations,
  };
}

describe('ExecuteProductDecision semantic enrichment wiring', () => {
  it('reads semantic representations for RECOMMEND and passes semantic evidence to recommendation synthesizer', async () => {
    const ai = createAiService();

    const productAgent = createProductAgentService();

    const node = createExecuteProductDecisionNode(
      ai.aiService,

      productAgent.service,
    );

    const result = await node(
      agentState({
        query: 'Какой из них лучше для повседневной носки?',

        requestId: 'request-recommend',

        record: activeRecord(),

        decision: capabilityDecision({
          action: 'RECOMMEND',

          positions: [1, 2],
        }),
      }),

      nodeConfig,
    );

    expect(
      productAgent.getProductSemanticRepresentations,
    ).toHaveBeenCalledTimes(1);

    expect(productAgent.getProductSemanticRepresentations).toHaveBeenCalledWith(
      ['adidas-1', 'adidas-2'],
    );

    expect(productAgent.getProductDetails).toHaveBeenCalledWith([
      'adidas-1',

      'adidas-2',
    ]);

    expect(ai.recommendationInvoke).toHaveBeenCalledTimes(1);

    const payload = recommendationPayload(ai.recommendationInvoke);

    expect(payload.context.semanticEvidence).toEqual([
      {
        position: 1,

        summary: 'Ретро-модель для повседневных городских образов.',

        targetAudience: ['Покупатели повседневной городской обуви'],

        styleAssociations: ['casual', 'retro'],

        useCases: ['повседневная носка', 'городские прогулки'],

        pricePositioning: 'средний ценовой сегмент',
      },

      {
        position: 2,

        summary: 'Повседневная городская модель в casual-стилистике.',

        targetAudience: ['Покупатели повседневной городской обуви'],

        styleAssociations: ['casual', 'retro'],

        useCases: ['повседневная носка', 'городские прогулки'],

        pricePositioning: 'средний ценовой сегмент',
      },
    ]);

    expect(JSON.stringify(payload.context.semanticEvidence)).not.toContain(
      'internal-search-tag',
    );

    expect(result.message).toBe('Для этой задачи лучше подходит Campus 00s.');

    expect(result.recommendationProductIds).toEqual(['adidas-2']);

    expect(result.recommendationProduct).toEqual({
      id: 'adidas-2',

      title: 'Campus 00s',

      price: '12800',

      image: '',
    });
  });

  it('continues RECOMMEND without semantic evidence when semantic reader fails', async () => {
    const ai = createAiService();

    const productAgent = createProductAgentService();

    productAgent.getProductSemanticRepresentations.mockRejectedValueOnce(
      new Error('Qdrant unavailable'),
    );

    const node = createExecuteProductDecisionNode(
      ai.aiService,

      productAgent.service,
    );

    const result = await node(
      agentState({
        query: 'Какой из них лучше?',

        requestId: 'request-recommend-semantic-failure',

        record: activeRecord(),

        decision: capabilityDecision({
          action: 'RECOMMEND',

          positions: [1, 2],
        }),
      }),

      nodeConfig,
    );

    expect(
      productAgent.getProductSemanticRepresentations,
    ).toHaveBeenCalledTimes(1);

    expect(ai.recommendationInvoke).toHaveBeenCalledTimes(1);

    const payload = recommendationPayload(ai.recommendationInvoke);

    expect(payload.context.semanticEvidence).toEqual([]);

    expect(payload.context.productFacts).toHaveLength(2);

    expect(result.message).toBe('Для этой задачи лучше подходит Campus 00s.');

    expect(result.recommendationProductIds).toEqual(['adidas-2']);

    expect(result.recommendationProduct?.id).toBe('adidas-2');
  });

  it('does not read semantic representations for DETAILS', async () => {
    const ai = createAiService();

    const productAgent = createProductAgentService();

    const node = createExecuteProductDecisionNode(
      ai.aiService,

      productAgent.service,
    );

    await node(
      agentState({
        query: 'Покажи первый подробнее',

        requestId: 'request-details',

        record: activeRecord(),

        decision: capabilityDecision({
          action: 'DETAILS',

          positions: [1],
        }),
      }),

      nodeConfig,
    );

    expect(
      productAgent.getProductSemanticRepresentations,
    ).not.toHaveBeenCalled();

    expect(ai.recommendationInvoke).not.toHaveBeenCalled();
  });

  it('builds COMPARE as one structured matrix and does not expose semantic use-cases as product claims', async () => {
    const ai = createAiService();

    const productAgent = createProductAgentService();

    productAgent.getProductSemanticRepresentations.mockResolvedValueOnce(
      new Map([
        [
          'adidas-1',

          {
            summary: 'Ретро-модель для повседневных городских образов.',

            targetAudience: ['Любители уличной моды'],

            styleAssociations: ['спортивный', 'винтажный', 'уличный стиль'],

            useCases: [
              'повседневная носка',

              'создание яркого современного образа',
            ],

            pricePositioning: 'средний ценовой сегмент',

            searchTags: ['retrieval-only-adidas-1'],
          },
        ],

        [
          'adidas-2',

          {
            summary: 'Повседневная модель с элементами скейтбординга.',

            targetAudience: ['Поклонники скейтбординга'],

            styleAssociations: ['скейтбординг', 'университетские цвета'],

            useCases: ['повседневная носка', 'занятия скейтбордингом'],

            pricePositioning: 'средний ценовой сегмент',

            searchTags: ['retrieval-only-adidas-2'],
          },
        ],
      ]),
    );

    const node = createExecuteProductDecisionNode(
      ai.aiService,

      productAgent.service,
    );

    const result = await node(
      agentState({
        query: 'Сравни первый и второй по цене',

        requestId: 'request-compare',

        record: activeRecord(),

        decision: capabilityDecision({
          action: 'COMPARE',

          positions: [1, 2],
        }),
      }),

      nodeConfig,
    );

    expect(
      productAgent.getProductSemanticRepresentations,
    ).toHaveBeenCalledTimes(1);

    expect(productAgent.getProductSemanticRepresentations).toHaveBeenCalledWith(
      ['adidas-1', 'adidas-2'],
    );

    expect(ai.recommendationInvoke).not.toHaveBeenCalled();

    const presentation = result.consultation?.comparisonPresentation;

    expect(presentation).not.toBeNull();

    expect(presentation?.rows.map((row) => row.attributeId)).toEqual([
      'price',

      'semantic.styleAssociations',
    ]);

    const styleRow = presentation?.rows.find(
      (row) => row.attributeId === 'semantic.styleAssociations',
    );

    expect(styleRow?.label).toBe('Стиль / ассоциации');

    expect(styleRow?.cells[0]?.value).toEqual([
      'спортивный',
      'винтажный',
      'уличный стиль',
    ]);

    expect(styleRow?.cells[1]?.value).toEqual([
      'скейтбординг',
      'университетские цвета',
    ]);

    expect(presentation?.keyDifferences).toEqual([]);

    expect(JSON.stringify(presentation)).not.toContain(
      'занятия скейтбордингом',
    );

    expect(JSON.stringify(presentation)).not.toContain('целевая аудитория');

    expect(JSON.stringify(presentation)).not.toContain('retrieval-only');

    expect(presentation).not.toHaveProperty('recommendation');

    expect(presentation).not.toHaveProperty('recommendedProductId');
  });

  it('continues COMPARE with factual rows when semantic reader fails', async () => {
    const ai = createAiService();

    const productAgent = createProductAgentService();

    productAgent.getProductSemanticRepresentations.mockRejectedValueOnce(
      new Error('Qdrant unavailable'),
    );

    const node = createExecuteProductDecisionNode(
      ai.aiService,

      productAgent.service,
    );

    const result = await node(
      agentState({
        query: 'Сравни первый и второй по цене',

        requestId: 'request-compare-semantic-failure',

        record: activeRecord(),

        decision: capabilityDecision({
          action: 'COMPARE',

          positions: [1, 2],
        }),
      }),

      nodeConfig,
    );

    expect(
      productAgent.getProductSemanticRepresentations,
    ).toHaveBeenCalledTimes(1);

    expect(ai.recommendationInvoke).not.toHaveBeenCalled();

    const presentation = result.consultation?.comparisonPresentation;

    expect(presentation).not.toBeNull();

    expect(presentation?.rows.map((row) => row.attributeId)).toEqual(['price']);

    expect(presentation?.keyDifferences).toEqual([]);

    expect(presentation).not.toHaveProperty('recommendation');

    expect(presentation).not.toHaveProperty('recommendedProductId');
  });

  it('does not read semantic representations for SEARCH', async () => {
    const ai = createAiService();

    const productAgent = createProductAgentService();

    const node = createExecuteProductDecisionNode(
      ai.aiService,

      productAgent.service,
    );

    await node(
      agentState({
        query: 'Найди мужские кроссовки Adidas',

        requestId: 'request-search',

        record: createConsultationApplicationRecord(),

        decision: searchDecision(),
      }),

      nodeConfig,
    );

    expect(productAgent.validate).toHaveBeenCalled();

    expect(productAgent.search).toHaveBeenCalledTimes(1);

    expect(
      productAgent.getProductSemanticRepresentations,
    ).not.toHaveBeenCalled();

    expect(ai.recommendationInvoke).not.toHaveBeenCalled();
  });
});
