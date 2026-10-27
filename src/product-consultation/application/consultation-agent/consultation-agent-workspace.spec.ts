import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';

import type { AiService } from '@/src/ai/ai.service';
import { ProductWorkspaceModelPlanSchema } from '../workspace/product-workspace-model-plan';
import { productWorkspacePrompt } from '../workspace/product-workspace.prompt';
import { createConsultationAgent } from './consultation.agent';

const context = { currentMessage: '  Покажи найденные товары  ' };
const clarification = { clarification: 'Какую подборку вы имеете в виду?' };

// An existing tolerated transport shape: normalization supplies the operation
// kind, query and public decision envelope before execution.
const rawPlan = {
  operations: [
    {
      target: { kind: 'current', view: 'results' },
      decision: { action: 'SHOW_RESULTS', selection: { kind: 'active' } },
      view: 'results',
    },
  ],
};

function harness(...responses: unknown[]) {
  let next = 0;
  const invoke = jest.fn(async (_messages: BaseMessage[]) => responses[next++]);
  const unused = {
    invoke: jest.fn(async () => {
      throw new Error('Only the workspace model may be invoked in this test.');
    }),
    withRetry: () => unused,
  };
  const withStructuredOutput = jest.fn(
    (_schema: unknown, options: { name: string }) =>
      options.name === 'product_workspace_decision' ? { invoke } : unused,
  );
  const getChatModel = jest.fn(() => ({ withStructuredOutput }));
  const agent = createConsultationAgent({
    getChatModel,
  } as unknown as AiService);

  return { agent, getChatModel, withStructuredOutput, invoke };
}

describe('ConsultationAgent workspace model boundary', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses STANDARD with the existing schema, includeRaw and prompt', async () => {
    const h = harness({ parsed: clarification });

    await expect(h.agent.decideWorkspace(context)).resolves.toEqual({
      ...clarification,
      operations: [],
    });
    expect(h.getChatModel).toHaveBeenCalledWith('STANDARD');
    expect(h.withStructuredOutput).toHaveBeenCalledWith(
      ProductWorkspaceModelPlanSchema,
      {
        name: 'product_workspace_decision',
        method: 'functionCalling',
        strict: false,
        includeRaw: true,
      },
    );
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke.mock.calls[0][0].map((message) => message.content)).toEqual(
      [productWorkspacePrompt, JSON.stringify(context)],
    );
  });

  it.each([
    ['direct tool args', { tool_calls: [{ args: rawPlan }] }],
    [
      'raw function object',
      {
        additional_kwargs: {
          tool_calls: [{ function: { arguments: rawPlan } }],
        },
      },
    ],
    [
      'raw function JSON',
      {
        additional_kwargs: {
          tool_calls: [{ function: { arguments: JSON.stringify(rawPlan) } }],
        },
      },
    ],
  ])(
    'extracts and normalizes %s without another model call',
    async (_name, raw) => {
      const h = harness({
        parsed: null,
        raw,
        parsing_error: 'transport shape',
      });

      const result = await h.agent.decideWorkspace(context);

      expect(result.clarification).toBeNull();
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        kind: 'consult',
        target: { kind: 'current', view: 'results' },
        query: 'Покажи найденные товары',
        actions: [
          {
            decision: { proposal: { action: 'SHOW_RESULTS' } },
            view: 'results',
          },
        ],
      });
      expect(h.invoke).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['empty', { parsed: null, raw: {} }],
    ['invalid', { parsed: { operations: [], clarification: null } }],
  ])(
    'repairs %s output exactly once with the same context',
    async (_name, first) => {
      const h = harness(first, { parsed: clarification });

      await expect(h.agent.decideWorkspace(context)).resolves.toEqual({
        ...clarification,
        operations: [],
      });

      expect(h.invoke).toHaveBeenCalledTimes(2);
      const retryMessages = h.invoke.mock.calls[1][0];
      expect(retryMessages).toHaveLength(3);
      expect(retryMessages[0].content).toBe(productWorkspacePrompt);
      expect(retryMessages[1].getType()).toBe('system');
      expect(retryMessages[1].content).toContain(
        'Предыдущий structured output оказался пустым или невалидным.',
      );
      expect(retryMessages[2].content).toBe(JSON.stringify(context));
    },
  );

  it('throws after two invalid outputs without an unbounded repair loop', async () => {
    const invalid = { parsed: { operations: [], clarification: null } };
    const h = harness(invalid, invalid, { parsed: clarification });

    await expect(h.agent.decideWorkspace(context)).rejects.toThrow(
      'ProductWorkspacePlanner: не удалось получить валидный workspace plan.',
    );
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });
});
