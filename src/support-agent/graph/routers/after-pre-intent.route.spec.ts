import { describe, expect, it } from '@jest/globals';

import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';
import { createConsultationApplicationRecord } from '@/src/product-consultation/application/runtime/consultation-application-record';
import { createProductConsultationState } from '@/src/product-consultation/core/state/consultation-state';
import { createSearchSpec } from '@/src/product-consultation/core/search/search-spec';
import {
  beginSearchExecution,
  commitSearchExecution,
} from '@/src/product-consultation/core/results/consultation-results';
import { afterPreIntentRoute } from './after-pre-intent.route';

function activeWorkspace() {
  const record = createConsultationApplicationRecord();
  const search = createSearchSpec({
    semanticIntent: 'мужские кроссовки Adidas',
    category: 'SHOES',
    constraints: [],
  });
  record.state = createProductConsultationState(search);
  const started = beginSearchExecution(record.results, search);
  record.results = commitSearchExecution(started.state, started.executionId, [
    {
      productId: 'campus',
      title: 'Campus 00s',
      price: '12800',
      image: 'campus.webp',
    },
    {
      productId: 'handball',
      title: 'HANDBALL SPEZIAL SHOES',
      price: '12500',
      image: 'handball.webp',
    },
  ]);
  return createProductWorkspace(record);
}

function createState(query: string) {
  return {
    query,
    preIntentRoute: 'requestRouterNode',
    activeAgent: 'productAgent',
    productWorkspace: activeWorkspace(),
  } as Parameters<typeof afterPreIntentRoute>[0];
}

describe('afterPreIntentRoute product follow-ups', () => {
  it('routes Russian negative completion directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('ничего не подходит'));

    expect(result).toBe('productAgent');
  });

  it('does not match a word that only starts like a details command', () => {
    const result = afterPreIntentRoute(createState('подробнеест'));

    expect(result).toBe('requestRouterNode');
  });

  it('does not match a word that only starts like a brand refinement', () => {
    const result = afterPreIntentRoute(createState('брендовый вариант'));

    expect(result).toBe('requestRouterNode');
  });
  it('routes Russian details follow-up directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('покажи подробнее второй'));

    expect(result).toBe('productAgent');
  });

  it('routes Russian referenced product follow-up directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('покажи второй вариант'));

    expect(result).toBe('productAgent');
  });

  it('routes bare Russian details command directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('подробнее'));

    expect(result).toBe('productAgent');
  });

  it('routes ordinal product question directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('первый дешевле?'));

    expect(result).toBe('productAgent');
  });

  it('routes demonstrative product reference directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('этот товар подробнее'));

    expect(result).toBe('productAgent');
  });

  it('routes product brand refinement directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('бренд Adidas'));

    expect(result).toBe('productAgent');
  });

  it('routes request for another product directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('покажи другой'));

    expect(result).toBe('productAgent');
  });
  it('routes Russian comparison directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('сравни первый и второй'));

    expect(result).toBe('productAgent');
  });

  it('routes Russian product advice directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('посоветуй купить Campus'));

    expect(result).toBe('productAgent');
  });

  it('routes Russian product completion directly to productAgent', () => {
    const result = afterPreIntentRoute(createState('беру второй'));

    expect(result).toBe('productAgent');
  });

  it('keeps customer-help questions outside product fast-path', () => {
    const result = afterPreIntentRoute(createState('расскажи про доставку'));

    expect(result).toBe('requestRouterNode');
  });

  it('routes an explicit next product search directly to productAgent', () => {
    const result = afterPreIntentRoute(
      createState('а теперь найди мужские кроссовки Adidas'),
    );

    expect(result).toBe('productAgent');
  });
  it('routes Russian inflected advice directly to productAgent', () => {
    const result = afterPreIntentRoute(
      createState('посоветуешь купить Campus?'),
    );

    expect(result).toBe('productAgent');
  });
});
