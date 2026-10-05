import { describe, expect, it, jest } from '@jest/globals';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { END, START, StateGraph, MemorySaver } from '@langchain/langgraph';
import type { AiService } from '@/src/ai/ai.service';
import type { CustomerHelpAgent } from '../../../agents/customer-help-agent/customer-help.agent';
import {
  action,
  constraint,
  harness,
  lane,
  named,
  newSearch,
  plan,
  positions,
  products,
} from '@/src/product-consultation/application/workspace/product-workspace.test-fixtures';
import { SupportAgentState } from '../../support-agent.state';
import { createRequestRouterNode } from '../request-router.node';
import { dispatchWorkers } from '../../routers/dispatch-workers';
import { createProductAgentWorker } from '../../workers/product-agent.worker';
import { createCustomerHelpAgentWorker } from '../../workers/customer-help-agent.worker';
import { createAggregateFinalAnswerNode } from '../aggregate-final-answer.node';

jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: jest.fn(async () => undefined),
}));

function supportHarness(h: ReturnType<typeof harness>) {
  let productQuery: string | null = null;
  let helpQuery: string | null = null;
  const route = jest.fn(async () => ({
    parsed: {
      workerQueries: {
        productAgent: productQuery,
        customerHelpAgent: helpQuery,
        orderAgent: null,
      },
      orderRequest: null,
      fallbackRoute: null,
      clarificationTopic: null,
      handoffRequest: null,
      reason: 'offline fixture',
    },
  }));
  const ai = {
    getYandexLiteChatModel: () => ({
      withStructuredOutput: () => RunnableLambda.from(route),
    }),
  } as unknown as AiService;
  const help = jest.fn(async (_input: { messages: BaseMessage[] }) => ({
    messages: [new AIMessage('Доставка курьером и в пункт выдачи.')],
  }));
  const invoke = jest.spyOn(h.agent, 'invoke');
  const graph = new StateGraph(SupportAgentState)
    .addNode('requestRouterNode', createRequestRouterNode(ai))
    .addNode('productAgent', createProductAgentWorker(h.agent), {
      ends: [END, 'aggregateAnswer'],
    })
    .addNode(
      'customerHelpAgent',
      createCustomerHelpAgentWorker({
        invoke: help,
      } as unknown as CustomerHelpAgent),
      { ends: [END, 'aggregateAnswer'] },
    )
    .addNode('aggregateAnswer', createAggregateFinalAnswerNode(ai))
    .addEdge(START, 'requestRouterNode')
    .addConditionalEdges('requestRouterNode', dispatchWorkers, [
      'productAgent',
      'customerHelpAgent',
    ])
    .addEdge('aggregateAnswer', END)
    .compile({ checkpointer: new MemorySaver() });
  let turn = 0;
  return {
    help,
    invoke,
    route,
    async run(
      query: string,
      product: string | null,
      store: string | null = null,
    ) {
      productQuery = product;
      helpQuery = store;
      return graph.invoke(
        {
          query,
          messages: [
            new HumanMessage({ content: query, id: `turn-${++turn}` }),
          ],
        },
        { configurable: { thread_id: 'offline-support' } },
      );
    },
  };
}

describe('Product multi-action across real Support routing, workers, aggregation and checkpoints', () => {
  it('recovers omitted delivery intent with zero products and grounded recovery, preserving isolated worker queries', async () => {
    const productQuery = 'Найди зелёные мужские кроссовки Nike';
    const h = harness(
      plan(
        newSearch('зелёные мужские кроссовки Nike', 'SHOES', [
          constraint('gender', 'MAN'),
          constraint('brand', 'Nike'),
          constraint('color', 'зелёные'),
        ]),
      ),
    );
    h.service.search.mockImplementation(async (spec) =>
      spec.constraints.length === 3 ? [] : products(spec),
    );
    const s = supportHarness(h);
    const full = `${productQuery} и расскажи про доставку`;
    // The Router model intentionally omits CustomerHelp. Real recovery must add it.
    const result = await s.run(full, productQuery);
    expect(s.invoke).toHaveBeenCalledTimes(1);
    expect(s.invoke.mock.calls[0][0]).toMatchObject({
      query: productQuery,
      sourceQuery: full,
    });
    expect(s.help).toHaveBeenCalledTimes(1);
    expect(s.help.mock.calls[0][0].messages[0].text).toBe(
      'расскажи про доставку',
    );
    expect(result.answer!.type).toBe('aggregate');
    if (result.answer!.type !== 'aggregate')
      throw new Error('expected aggregate');
    expect(result.answer!.message).toMatch(
      /Товары:\n[\s\S]*снятии[\s\S]*Информация магазина:\nДоставка/,
    );
    const product = result.answer!.blocks.find(
      (b) => b.worker === 'product_search',
    )!;
    if (product.worker !== 'product_search')
      throw new Error('expected product');
    expect(product.data.groups).toEqual([]);
    expect(product.data.resultGroups![0].recovery!.options).toHaveLength(2);
    expect(result.requestRouter!.reason).toContain(
      'Deterministic customer-help recovery',
    );
  });

  it('retains the same workspace across Product comparison, delivery-only turn and Product follow-up', async () => {
    const h = harness();
    const s = supportHarness(h);
    const initial = await s.run('Найди кроссовки', 'Найди кроссовки');
    h.setPlan(
      plan(lane('Сравни кроссовки', [action('COMPARE', positions(1, 2))])),
    );
    const compared = await s.run(
      'Сравни первые два кроссовка',
      'Сравни первые два кроссовка',
    );
    const saved = structuredClone(compared.productWorkspace);
    const delivery = await s.run(
      'А что у вас с доставкой?',
      null,
      'Какие условия доставки?',
    );
    expect(delivery.productWorkspace).toEqual(saved);
    expect(delivery.answer!.type).toBe('customer_help');
    expect(s.invoke).toHaveBeenCalledTimes(2);
    h.setPlan(
      plan(
        lane('Сравни второй и третий из выдачи', [
          action('COMPARE', positions(2, 3)),
          action('DETAILS', positions(3)),
        ]),
      ),
    );
    const resumed = await s.run(
      'Вернёмся к кроссовкам. Сравни второй и третий из выдачи и покажи третий подробно',
      'Сравни второй и третий кроссовки из выдачи и покажи третий подробно',
    );
    expect(resumed.productWorkspace!.tasks[0].taskId).toBe(
      initial.productWorkspace!.tasks[0].taskId,
    );
    expect(resumed.productWorkspace!.tasks[0].record.revision).toBeGreaterThan(
      saved!.tasks[0].record.revision,
    );
    expect(h.service.search).toHaveBeenCalledTimes(1);
    expect(resumed.answer!.type).toBe('product_agent');
    if (resumed.answer!.type !== 'product_agent')
      throw new Error('expected product');
    expect(
      resumed.answer!.resultGroups![0].presentations!.map((p) => p.kind),
    ).toEqual(['comparison', 'details']);
    expect(h.service.getProductDetails.mock.calls.at(-1)![0]).toEqual([
      'кроссовки-3',
    ]);
  });

  it('executes one Product invocation for three task lanes with ordered actions and CustomerHelp in the same turn', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки'),
        newSearch('платье', 'CLOTHES'),
        newSearch('шорты', 'CLOTHES'),
      ),
    );
    const s = supportHarness(h);
    const initial = await s.run(
      'Найди кроссовки, платье и шорты',
      'Найди кроссовки, платье и шорты',
    );
    expect(s.invoke).toHaveBeenCalledTimes(1);
    expect(h.service.search).toHaveBeenCalledTimes(3);
    const workspace = initial.productWorkspace!;
    h.setPlan(
      plan(
        lane(
          'Сравни кроссовки',
          [action('COMPARE', positions(1, 2))],
          named(workspace, 0, 'кроссовки'),
        ),
        lane(
          'Подробности платья',
          [action('DETAILS', positions(3))],
          named(workspace, 1, 'платье'),
        ),
        lane(
          'Подробности шорт',
          [action('DETAILS', positions(2)), action('DETAILS', positions(3))],
          named(workspace, 2, 'шорты'),
        ),
      ),
    );
    const productQuery = 'Сравни кроссовки, покажи платье и шорты подробнее';
    const result = await s.run(
      `${productQuery} и расскажи про доставку`,
      productQuery,
      'Какие условия доставки?',
    );
    expect(s.invoke).toHaveBeenCalledTimes(2);
    expect(s.help).toHaveBeenCalledTimes(1);
    expect(h.decide).toHaveBeenCalledTimes(2);
    expect(h.respond).not.toHaveBeenCalled();
    expect(result.answer!.type).toBe('aggregate');
    if (result.answer!.type !== 'aggregate')
      throw new Error('expected aggregate');
    expect(result.answer!.message).toMatch(
      /Товары:\n[\s\S]*Информация магазина:\nДоставка/,
    );
    const product = result.answer!.blocks[0];
    if (product.worker !== 'product_search')
      throw new Error('expected product');
    expect(product.data.groups).toEqual([]);
    expect(
      product.data.resultGroups!.map((g) =>
        g.presentations!.map((p) => p.kind),
      ),
    ).toEqual([['comparison'], ['details'], ['details', 'details']]);
  });

  it('does not dispatch CustomerHelp for shoes used in delivery work', async () => {
    const h = harness(plan(newSearch('кроссовки для работы в доставке')));
    const s = supportHarness(h);
    const query = 'Найди кроссовки для работы в доставке';
    const result = await s.run(query, query);
    expect(result.answer!.type).toBe('product_agent');
    expect(s.help).not.toHaveBeenCalled();
  });
});
