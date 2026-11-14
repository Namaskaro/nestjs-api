import { describe, expect, it } from '@jest/globals';

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';

import type { AiService } from '@/src/ai/ai.service';
import { createHandoffAgentGraph } from '../handoff-agent.graph';
import { entryHandoffRoute } from '../routes/entry-handoff.route';
import { HandoffEvidenceSchema } from '../schemas/handoff.schema';

function createHandoffWithUnavailableModel() {
  return createHandoffAgentGraph({
    getChatModel: () => ({
      withStructuredOutput: () =>
        RunnableLambda.from(() => {
          throw new Error('Test model unavailable');
        }),
    }),
  } as unknown as AiService);
}

describe('Handoff Agent behavior', () => {
  it('явный запрос оператора не требует повторного согласия', () => {
    const route = entryHandoffRoute({
      handoffRequest: {
        reason: 'CUSTOMER_REQUEST',
        trigger: 'EXPLICIT_USER_REQUEST',
      },
    });

    expect(route).toBe('prepareHandoffNode');
  });

  it('предложение оператора требует подтверждения покупателя', () => {
    const route = entryHandoffRoute({
      handoffRequest: {
        reason: 'UNSUPPORTED_ACTION',
        trigger: 'UNSUPPORTED_INTENT',
      },
    });

    expect(route).toBe('operatorOfferNode');
  });

  it('резервный контекст сохраняет обращение без выдуманных фактов', async () => {
    const issue = 'Не получается оформить заказ №10482';
    const result = await createHandoffWithUnavailableModel().invoke({
      messages: [
        new HumanMessage(issue),
        new AIMessage('Хотите, я подключу оператора?'),
        new HumanMessage('Да'),
      ],
      handoffRequest: {
        reason: 'CUSTOMER_REQUEST',
        trigger: 'EXPLICIT_USER_REQUEST',
        evidence: HandoffEvidenceSchema.parse({
          source: 'orderAgent',
          userReportedIssue: issue,
        }),
      },
    });
    const context = result.handoff?.context;

    expect(context).toMatchObject({
      issue,
      verifiedFacts: [],
      actionsTaken: [],
      relatedEntities: null,
    });
    expect(context?.unresolvedQuestions.length).toBeGreaterThan(0);
  });

  it('если причина неизвестна, агент не придумывает проблему', async () => {
    const result = await createHandoffWithUnavailableModel().invoke({
      messages: [new HumanMessage('Позовите оператора')],
      handoffRequest: {
        reason: 'CUSTOMER_REQUEST',
        trigger: 'EXPLICIT_USER_REQUEST',
      },
    });

    expect(result.handoff?.context).toMatchObject({
      issue: 'Обращение покупателя: Позовите оператора',
      userGoal: 'Связаться с оператором',
      verifiedFacts: [],
      actionsTaken: [],
      relatedEntities: null,
    });
  });
});
