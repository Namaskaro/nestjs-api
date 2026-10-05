import { describe, expect, it, jest } from '@jest/globals';

import { HumanMessage } from '@langchain/core/messages';

import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';

import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';
import {
  action,
  harness,
  lane,
  plan,
  positions,
} from '@/src/product-consultation/application/workspace/product-workspace.test-fixtures';

import type { SupportAgentStateType } from '../../support-agent.state';

import { createProductAgentWorker } from '../product-agent.worker';

jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: jest.fn(async () => undefined),
}));

function state(): SupportAgentStateType {
  return {
    query: 'тест',

    messages: [
      new HumanMessage({
        id: 'message-1',

        content: 'тест',
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

const config = {
  configurable: {
    thread_id: 'conversation-1',
  },
} as LangGraphRunnableConfig;

describe('ProductAgentWorker presentation groups', () => {
  it('preserves ordered task presentations through the real Product graph without empty search cards', async () => {
    const h = harness();
    const initial = await h.run();
    h.setPlan(
      plan(
        lane('кроссовки', [
          action('COMPARE', positions(1, 2)),
          action('DETAILS', positions(3)),
        ]),
      ),
    );
    const input = state();
    input.productWorkspace = initial.workspace;
    input.query = 'Сравни первые два кроссовка и покажи третий подробнее';
    const worker = createProductAgentWorker(h.agent);
    const result = await worker(input, config);
    const update = (
      result as {
        update: {
          answer: {
            groups: unknown[];
            resultGroups: Array<{
              presentations: Array<{ kind: string; actionOrdinal: number }>;
            }>;
          };
        };
      }
    ).update;
    expect(update.answer.groups).toEqual([]);
    expect(update.answer.resultGroups).toHaveLength(1);
    expect(
      update.answer.resultGroups[0].presentations.map(
        ({ kind, actionOrdinal }) => [kind, actionOrdinal],
      ),
    ).toEqual([
      ['comparison', 0],
      ['details', 1],
    ]);
    expect(h.respond).not.toHaveBeenCalled();
  });
  it('does not expose an empty search group to UI', async () => {
    const workspace = createProductWorkspace();

    const invoke = jest.fn(async () => ({
      workspace,

      message: 'Подходящих товаров не нашёл.',

      groups: [
        {
          taskId: 'task-1',

          query: 'зелёные Nike',

          status: 'empty',

          message: 'Подходящих товаров не нашёл.',

          products: [],

          consultation: null,
        },
      ],

      consultation: null,

      consultationCompletion: null,

      handoffRequested: false,
    }));

    const worker = createProductAgentWorker({
      invoke,
    } as unknown as ProductAgent);

    const result = await worker(
      state(),

      config,
    );

    const update = (
      result as {
        update: {
          answer: {
            groups: unknown[];
          };
        };
      }
    ).update;

    expect(update.answer.groups).toEqual([]);
  });

  it('does not expose a details-only group to search UI', async () => {
    const workspace = createProductWorkspace();

    const invoke = jest.fn(async () => ({
      workspace,

      message: 'Вот подробная информация о товаре.',

      groups: [
        {
          taskId: 'task-1',

          query: 'мужские кроссовки',

          status: 'ready',

          message: 'Вот подробная информация о товаре.',

          products: [],

          consultation: null,
        },
      ],

      consultation: null,

      consultationCompletion: null,

      handoffRequested: false,
    }));

    const worker = createProductAgentWorker({
      invoke,
    } as unknown as ProductAgent);

    const result = await worker(
      state(),

      config,
    );

    const update = (
      result as {
        update: {
          answer: {
            groups: unknown[];
          };
        };
      }
    ).update;

    expect(update.answer.groups).toEqual([]);
  });

  it('keeps groups that contain actual product cards', async () => {
    const workspace = createProductWorkspace();

    const group = {
      taskId: 'task-1',

      query: 'мужские кроссовки',

      status: 'ready' as const,

      message: '',

      products: [
        {
          id: 'product-1',

          title: 'Campus 00s',

          price: '12800',

          image: '',
        },
      ],

      consultation: null,
    };

    const invoke = jest.fn(async () => ({
      workspace,

      message: 'Нашёл подходящие варианты.',

      groups: [group],

      consultation: null,

      consultationCompletion: null,

      handoffRequested: false,
    }));

    const worker = createProductAgentWorker({
      invoke,
    } as unknown as ProductAgent);

    const result = await worker(
      state(),

      config,
    );

    const update = (
      result as {
        update: {
          answer: {
            groups: unknown[];
          };
        };
      }
    ).update;

    expect(update.answer.groups).toEqual([group]);
  });
});
