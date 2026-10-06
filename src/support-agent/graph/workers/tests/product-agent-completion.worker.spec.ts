import { describe, expect, it, jest } from '@jest/globals';

import { HumanMessage } from '@langchain/core/messages';

import {
  END,
  type Command,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import type { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';

import type { SupportAgentStateType } from '../../support-agent.state';

import { createProductAgentWorker } from '../product-agent.worker';

jest.mock(
  '@langchain/core/callbacks/dispatch',

  () => ({
    dispatchCustomEvent: jest.fn(async () => undefined),
  }),
);

const config = {
  configurable: {
    thread_id: 'completion-worker-test',
  },
} as LangGraphRunnableConfig;

function state(): SupportAgentStateType {
  return {
    query: 'Спасибо, всё',

    messages: [
      new HumanMessage({
        id: 'completion-message',

        content: 'Спасибо, всё',
      }),
    ],

    preIntentRoute: 'requestRouterNode',

    rejectCount: 0,

    clarification: null,

    requestRouter: null,

    activeAgent: 'productAgent',

    productContext: null,

    productWorkspace: createProductWorkspace(),

    productConsultationRecord: null,

    executionMode: 'single',

    workerResults: [],

    handoffRequest: null,

    handoff: null,

    answer: null,
  };
}

describe('Product worker consultation completion', () => {
  it('reuses the existing consultation session pipeline and returns feedback presentation', async () => {
    const workspace = createProductWorkspace();

    const invoke = jest.fn(async () => ({
      workspace,

      groups: [
        {
          taskId: 'task-1',

          query: 'женские платья',

          status: 'closed' as const,

          message:
            'Спасибо за консультацию. Если понадобится помощь с выбором — обращайтесь.',

          products: [],

          presentations: [],

          consultation: null,
        },
      ],

      message:
        'Спасибо за консультацию. Если понадобится помощь с выбором — обращайтесь.',

      consultation: null,

      consultationCompletion: null,

      completionRequested: true,

      handoffRequested: false,
    }));

    const worker = createProductAgentWorker({
      invoke,
    } as unknown as ProductAgent);

    const result = (await worker(
      state(),

      config,
    )) as Command;

    expect(result.goto).toEqual([END]);

    const update = result.update as Partial<SupportAgentStateType>;

    expect(update.productContext?.consultationSession?.status).toBe(
      'COMPLETED',
    );

    expect(update.productContext?.consultationSession?.completionReason).toBe(
      'USER_DONE',
    );

    expect(update.answer).toMatchObject({
      type: 'product_agent',

      consultationCompletion: {
        status: 'COMPLETED',

        reason: 'USER_DONE',

        feedbackRequest: {
          kind: 'HELPFULNESS',

          options: ['HELPFUL', 'NOT_HELPFUL'],
        },

        feedback: null,
      },
    });
  });
});
