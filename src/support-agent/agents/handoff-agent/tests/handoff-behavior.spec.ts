import { describe, expect, it } from '@jest/globals';

import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { entryHandoffRoute } from '../routes/entry-handoff.route';

import { createFallbackHandoffContext } from '../nodes/prepare-handoff.node';

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

  it('резервный контекст сохраняет обращение без выдуманных фактов', () => {
    const context = createFallbackHandoffContext([
      new HumanMessage('Не получается оформить заказ №10482'),

      new AIMessage('Хотите, я подключу оператора?'),

      new HumanMessage('Да'),
    ]);

    expect(context.issue).toContain('Не получается оформить заказ №10482');

    expect(context.verifiedFacts).toEqual([]);

    expect(context.actionsTaken).toEqual([]);

    expect(context.relatedEntities?.orderIds).toEqual([]);

    expect(context.unresolvedQuestions.length).toBeGreaterThan(0);
  });

  it('если причина неизвестна, агент не придумывает проблему', () => {
    const context = createFallbackHandoffContext([
      new HumanMessage('Позовите оператора'),
    ]);

    expect(context.issue).toBe('Покупатель запросил разговор с оператором');

    expect(context.verifiedFacts).toEqual([]);

    expect(context.actionsTaken).toEqual([]);
  });
});
