import { describe, expect, it } from '@jest/globals';

import { inferCustomerHelpWorkerQuery } from '../request-router.node';

describe('RequestRouter cross-domain customer help recovery', () => {
  it('recovers delivery intent from product plus delivery request', () => {
    expect(
      inferCustomerHelpWorkerQuery(
        'Найди зелёные мужские кроссовки Nike и расскажи про доставку',
      ),
    ).toBe('расскажи про доставку');
  });

  it('recovers delivery policy question', () => {
    expect(
      inferCustomerHelpWorkerQuery('Найди Nike, какие сроки доставки?'),
    ).toContain('сроки доставки');
  });

  it('does not confuse product usage in delivery work with store delivery policy', () => {
    expect(
      inferCustomerHelpWorkerQuery(
        'Найди удобные кроссовки для работы в доставке',
      ),
    ).toBeNull();
  });

  it('recovers payment intent', () => {
    expect(
      inferCustomerHelpWorkerQuery(
        'Покажи платье и расскажи про способы оплаты',
      ),
    ).toContain('способы оплаты');
  });
});
