import { describe, expect, it } from '@jest/globals';

import { HumanMessage } from '@langchain/core/messages';

import type { Send } from '@langchain/langgraph';

import type { SupportAgentStateType } from '../../support-agent.state';

import { dispatchWorkers } from '../dispatch-workers';

function createState(input: {
  query: string;

  workers: Array<'productAgent' | 'customerHelpAgent'>;

  productQuery: string | null;

  customerHelpQuery: string | null;
}): SupportAgentStateType {
  const messages = [
    new HumanMessage({
      id: 'message-1',

      content: input.query,
    }),
  ];

  return {
    query: input.query,

    messages,

    preIntentRoute: 'requestRouterNode',

    rejectCount: 0,

    clarification: null,

    requestRouter: {
      route: 'execute',

      workers: input.workers,

      workerQueries: {
        productAgent: input.productQuery,

        customerHelpAgent: input.customerHelpQuery,
      },

      clarificationTopic: null,

      handoffRequest: null,

      reason: 'test',
    },

    activeAgent: null,

    productContext: null,

    productConsultationRecord: null,

    productWorkspace: null,

    executionMode: input.workers.length > 1 ? 'multi' : 'single',

    workerResults: [],

    handoffRequest: null,

    handoff: null,

    answer: null,
  };
}

function sendArgs(send: Send): SupportAgentStateType {
  return send.args as SupportAgentStateType;
}

describe('dispatchWorkers', () => {
  it('dispatches isolated Product and Customer Help queries for multi-intent request', () => {
    const state = createState({
      query: 'Покажи чёрные кроссовки и расскажи про доставку',

      workers: ['productAgent', 'customerHelpAgent'],

      productQuery: 'Покажи чёрные кроссовки',

      customerHelpQuery: 'Расскажи про доставку',
    });

    const sends = dispatchWorkers(state);

    expect(sends).toHaveLength(2);

    const productSend = sends[0];

    const customerHelpSend = sends[1];

    expect(productSend?.node).toBe('productAgent');

    expect(sendArgs(productSend!).query).toBe('Покажи чёрные кроссовки');

    expect(sendArgs(productSend!).messages).toStrictEqual(state.messages);

    expect(customerHelpSend?.node).toBe('customerHelpAgent');

    expect(sendArgs(customerHelpSend!).query).toBe('Расскажи про доставку');

    expect(sendArgs(customerHelpSend!).messages).toHaveLength(1);

    expect(sendArgs(customerHelpSend!).messages[0]?.text).toBe(
      'Расскажи про доставку',
    );
  });

  it('uses isolated ProductAgent workerQuery instead of original full query', () => {
    const state = createState({
      query:
        'Покажи мужские кроссовки Nike и ещё расскажи про условия возврата',

      workers: ['productAgent'],

      productQuery: 'Покажи мужские кроссовки Nike',

      customerHelpQuery: null,
    });

    const sends = dispatchWorkers(state);

    expect(sends).toHaveLength(1);

    const productSend = sends[0];

    expect(productSend?.node).toBe('productAgent');

    expect(sendArgs(productSend!).query).toBe('Покажи мужские кроссовки Nike');

    expect(sendArgs(productSend!).query).not.toBe(state.query);
  });

  it('preserves original ProductAgent message history while replacing current query', () => {
    const state = createState({
      query: 'Найди Adidas и расскажи про доставку',

      workers: ['productAgent', 'customerHelpAgent'],

      productQuery: 'Найди Adidas',

      customerHelpQuery: 'Расскажи про доставку',
    });

    const sends = dispatchWorkers(state);

    const productSend = sends[0];

    const args = sendArgs(productSend!);

    expect(args.query).toBe('Найди Adidas');

    expect(args.messages).toStrictEqual(state.messages);

    expect(args.messages.at(-1)?.text).toBe(
      'Найди Adidas и расскажи про доставку',
    );
  });

  it('creates an isolated HumanMessage for CustomerHelpAgent', () => {
    const state = createState({
      query: 'Найди Adidas и расскажи про оплату',

      workers: ['productAgent', 'customerHelpAgent'],

      productQuery: 'Найди Adidas',

      customerHelpQuery: 'Расскажи про оплату',
    });

    const sends = dispatchWorkers(state);

    const customerHelpSend = sends[1];

    const args = sendArgs(customerHelpSend!);

    expect(args.query).toBe('Расскажи про оплату');

    expect(args.messages).toHaveLength(1);

    expect(HumanMessage.isInstance(args.messages[0])).toBe(true);

    expect(args.messages[0]?.text).toBe('Расскажи про оплату');
  });

  it('throws when selected worker has no workerQuery', () => {
    const state = createState({
      query: 'Найди Adidas',

      workers: ['productAgent'],

      productQuery: null,

      customerHelpQuery: null,
    });

    expect(() => dispatchWorkers(state)).toThrow(
      'DispatchWorkers: отсутствует query для productAgent',
    );
  });
});
