import { describe, expect, it, jest } from '@jest/globals';

import type { ConsultationResultProduct } from '../../../core/results/consultation-results.schema';

import type { SearchSpec } from '../../../core/search/search-spec.schema';

import type { ProductSearchPort } from '../../search/product-search.port';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from '../consultation-application-store.port';

import { ConsultationWriteOwner } from '../consultation-write-owner';

function cloneRecord(
  record: ConsultationApplicationRecord,
): ConsultationApplicationRecord {
  return ConsultationApplicationRecordSchema.parse(structuredClone(record));
}

function searchProposal() {
  return {
    action: 'SEARCH' as const,

    taskTransition: 'start_new' as const,

    search: {
      semanticIntent: 'мужские кроссовки Nike',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq' as const,

          value: 'MAN',

          unit: null,
        },

        {
          attributeId: 'brand',

          operator: 'eq' as const,

          value: 'Nike',

          unit: null,
        },
      ],
    },

    searchPatch: null,

    memoryObservations: [],

    selection: null,

    feedback: null,
  };
}

function product(id: string): ConsultationResultProduct {
  return {
    productId: id,

    title: id,

    price: '15000',

    image: null,
  };
}

/**
 * Первый save:
 *
 * prepared record + pendingSearch
 * успешно сохраняется.
 *
 * Второй save:
 *
 * successful search finalization
 * падает.
 *
 * Третий save намеренно был бы успешным.
 *
 * Это важно:
 *
 * старая реализация после падения
 * второго save попадала в общий catch,
 * ошибочно вызывала finalizeFailedSearch()
 * и третьим save записывала search_failed.
 */
class FailSuccessfulFinalizationStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord | null = null;

  public saveCalls = 0;

  public async load(
    _conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    return this.record === null ? null : cloneRecord(this.record);
  }

  public async saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void> {
    const actualRevision = this.record?.revision ?? 0;

    if (actualRevision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,

        input.expectedRevision,

        this.record?.revision ?? null,
      );
    }

    this.saveCalls += 1;

    if (this.saveCalls === 2) {
      throw new Error(
        'Persistence unavailable during successful search finalization.',
      );
    }

    this.record = cloneRecord(input.record);
  }
}

class InMemoryConsultationStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord | null = null;

  public async load(
    _conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    return this.record === null ? null : cloneRecord(this.record);
  }

  public async saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void> {
    const actualRevision = this.record?.revision ?? 0;

    if (actualRevision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,

        input.expectedRevision,

        this.record?.revision ?? null,
      );
    }

    this.record = cloneRecord(input.record);
  }
}

describe('ConsultationWriteOwner persistence failure semantics', () => {
  it('does not reclassify successful SearchPort execution as search_failed when successful-result persistence fails', async () => {
    const store = new FailSuccessfulFinalizationStore();

    const search = jest.fn(
      async (_search: SearchSpec): Promise<ConsultationResultProduct[]> => [
        product('nike-1'),
      ],
    );

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search,
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createExecutionId: () => 'execution-success',

        createResultId: () => 'result-success',
      },
    );

    await expect(
      owner.execute({
        conversationId: 'conversation-1',

        expectedRevision: 0,

        requestId: 'request-1',

        proposal: searchProposal(),

        expectedResultId: null,
      }),
    ).rejects.toThrow(
      'Persistence unavailable during successful search finalization.',
    );

    /**
     * SearchPort реально отработал успешно
     * ровно один раз.
     */
    expect(search).toHaveBeenCalledTimes(1);

    /**
     * Ключевой S2 invariant:
     *
     * после persistence failure
     * WriteOwner НЕ попытался
     * выполнить третий save
     * с fake search_failed state.
     */
    expect(store.saveCalls).toBe(2);

    const persisted = await store.load('conversation-1');

    expect(persisted).not.toBeNull();

    /**
     * Первый save действительно
     * сохранил pending execution.
     *
     * Успешный результат не удалось
     * зафиксировать, но и ложно
     * объявлять поиск неуспешным нельзя.
     */
    expect(persisted?.results.pendingSearch?.executionId).toBe(
      'execution-success',
    );

    expect(persisted?.results.active).toBeNull();

    expect(persisted?.results.lastConfirmed).toBeNull();

    expect(persisted?.results.lastFailure).toBeUndefined();
  });

  it('still records a real SearchPort failure as search_failed', async () => {
    const store = new InMemoryConsultationStore();

    const searchError = new Error('Qdrant unavailable.');

    const search = jest.fn(
      async (_search: SearchSpec): Promise<ConsultationResultProduct[]> => {
        throw searchError;
      },
    );

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search,
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createExecutionId: () => 'execution-failed',
      },
    );

    const result = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-1',

      proposal: searchProposal(),

      expectedResultId: null,
    });

    expect(result.status).toBe('search_failed');

    if (result.status !== 'search_failed') {
      throw new Error('Expected real SearchPort failure.');
    }

    expect(result.error).toBe(searchError);

    expect(search).toHaveBeenCalledTimes(1);

    expect(result.record.results.pendingSearch).toBeNull();

    expect(result.record.results.active).toBeNull();

    expect(result.record.results.lastConfirmed).toBeNull();

    expect(result.record.results.lastFailure).toBeDefined();
  });
});
