import { describe, expect, it, jest } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import {
  Command,
  END,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import { createProductAgentWorker } from '../product-agent.worker';
import { dispatchWorkers } from '../../routers/dispatch-workers';
import type { SupportAgentStateType } from '../../support-agent.state';
import type { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';
import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';
import { createConsultationApplicationRecord } from '@/src/product-consultation/application/runtime/consultation-application-record';
import { createProductConsultationState } from '@/src/product-consultation/core/state/consultation-state';
import { createSearchSpec } from '@/src/product-consultation/core/search/search-spec';

jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: jest.fn(async () => undefined),
}));

function supportState(multi: boolean): SupportAgentStateType {
  return {
    query: 'Найди Nike и платье и расскажи про доставку',
    messages: [
      new HumanMessage({
        id: 'server-message-1',
        content: 'Найди Nike и платье и расскажи про доставку',
      }),
    ],
    productWorkspace: null,
    productConsultationRecord: null,
    productContext: null,
    executionMode: multi ? 'multi' : 'single',
    requestRouter: {
      route: 'execute',
      workers: multi ? ['productAgent', 'customerHelpAgent'] : ['productAgent'],
      workerQueries: {
        productAgent: 'Найди Nike и платье',
        customerHelpAgent: multi ? 'Расскажи про доставку' : null,
        orderAgent: null,
      },
      orderRequest: null,
      clarificationTopic: null,
      handoffRequest: null,
      reason: 'offline',
    },
    activeAgent: null,
    preIntentRoute: 'requestRouterNode',
    rejectCount: 0,
    clarification: null,
    workerResults: [],
    handoffRequest: null,
    handoff: null,
    answer: null,
  };
}
function stub() {
  const workspace = createProductWorkspace();
  const groups = ['Nike', 'платье'].map((query, index) => ({
    taskId: `task-${index}`,
    query,
    status: 'ready',
    message: 'Найдены товары.',
    products: [
      { id: `product-${index}`, title: query, price: '1000', image: '' },
    ],
    consultation: null,
  }));
  const invoke = jest.fn(async (_input: unknown) => ({
    workspace,
    groups,
    message: 'Две подборки.',
    consultation: null,
    consultationCompletion: null,
    handoffRequested: false,
  }));
  return {
    invoke,
    workspace,
    groups,
    worker: createProductAgentWorker({ invoke } as unknown as ProductAgent),
  };
}
const config = {
  configurable: { thread_id: 'conversation' },
} as LangGraphRunnableConfig;

describe('Product worker workspace integration', () => {
  it('MI-01 keeps cross-domain query isolation, one Product invocation and multiple product groups', async () => {
    const state = supportState(true);
    const sends = dispatchWorkers(state);
    expect(sends.filter((send) => send.node === 'productAgent')).toHaveLength(
      1,
    );
    expect(sends[1].args.query).toBe('Расскажи про доставку');
    const h = stub();
    const result = (await h.worker(sends[0].args, config)) as Command;
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke.mock.calls[0][0]).toMatchObject({
      query: 'Найди Nike и платье',
      requestId: 'server-message-1',
    });
    expect(result.goto).toEqual(['aggregateAnswer']);
    const update = result.update as Partial<SupportAgentStateType>;
    expect(update.workerResults[0]).toMatchObject({
      worker: 'product_search',
      data: { groups: h.groups },
    });
    expect(update.productWorkspace).toEqual(h.workspace);
  });

  it('single-domain answer preserves task IDs through frontend schema and migrates old record once', async () => {
    const state = supportState(false);
    const record = createConsultationApplicationRecord();
    record.state = createProductConsultationState(
      createSearchSpec({
        semanticIntent: 'Nike',
        category: 'SHOES',
        constraints: [],
      }),
    );
    state.productConsultationRecord = record;
    const h = stub();
    const result = (await h.worker(state, config)) as Command;
    const input = h.invoke.mock.calls[0][0] as {
      workspace: ReturnType<typeof createProductWorkspace>;
    };
    expect(input.workspace.tasks[0].record).toEqual(record);
    const update = result.update as Partial<SupportAgentStateType>;
    expect(result.goto).toEqual([END]);
    expect(update.answer).toMatchObject({
      type: 'product_agent',
      groups: h.groups,
    });
    expect(update.productConsultationRecord).toBeNull();
    expect(update.productWorkspace).toEqual(h.workspace);
  });
});
