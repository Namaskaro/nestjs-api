import { describe, expect, it, jest } from '@jest/globals';

import { HumanMessage } from '@langchain/core/messages';

import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';

import type { SupportAgentStateType } from '../../support-agent.state';

import { createProductAgentWorker } from '../product-agent.worker';

jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: jest.fn(async () => undefined),
}));

describe('ProductAgentWorker source query', () => {
  it('passes isolated Product query and original user message separately', async () => {
    const workspace = createProductWorkspace();

    const invoke = jest.fn(async () => ({
      workspace,

      groups: [],

      message: 'Готово.',

      consultation: null,

      consultationCompletion: null,

      handoffRequested: false,
    }));

    const worker = createProductAgentWorker({
      invoke,
    } as unknown as ProductAgent);

    const state: SupportAgentStateType = {
      query: 'А ещё найди Adidas',

      messages: [
        new HumanMessage({
          id: 'message-1',

          content: 'А ещё найди Adidas и расскажи про доставку',
        }),
      ],

      preIntentRoute: 'requestRouterNode',

      rejectCount: 0,

      clarification: null,

      requestRouter: null,

      activeAgent: 'productAgent',

      productContext: null,

      productWorkspace: workspace,

      productConsultationRecord: null,

      executionMode: 'single',

      workerResults: [],

      handoffRequest: null,

      handoff: null,

      answer: null,
    };

    const config = {
      configurable: {
        thread_id: 'conversation-1',
      },
    } as LangGraphRunnableConfig;

    await worker(
      state,

      config,
    );

    expect(invoke).toHaveBeenCalledTimes(1);

    expect(invoke.mock.calls[0][0]).toMatchObject({
      query: 'А ещё найди Adidas',

      sourceQuery: 'А ещё найди Adidas и расскажи про доставку',

      conversationId: 'conversation-1',

      requestId: 'message-1',
    });
  });
});
