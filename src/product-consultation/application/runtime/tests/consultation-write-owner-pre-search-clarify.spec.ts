import { describe, expect, it } from '@jest/globals';

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

class InMemoryStore implements ConsultationApplicationStore {
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
    const actual = this.record?.revision ?? 0;

    if (actual !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,

        input.expectedRevision,

        this.record?.revision ?? null,
      );
    }

    this.record = cloneRecord(input.record);
  }
}

class FakeSearchPort implements ProductSearchPort {
  public validateCalls = 0;

  public searchCalls = 0;

  public failValidation = false;

  public validate(_search: SearchSpec): void {
    this.validateCalls += 1;

    if (this.failValidation) {
      throw new Error('SearchSpec is not executable by store.');
    }
  }

  public async search(
    _search: SearchSpec,
  ): Promise<ConsultationResultProduct[]> {
    this.searchCalls += 1;

    return [
      {
        productId: 'product-1',

        title: 'Product 1',

        price: '10000',

        image: null,
      },
    ];
  }
}

function weddingSuitSearch() {
  return {
    semanticIntent: 'костюм на свадьбу',

    category: 'CLOTHES',

    constraints: [
      {
        attributeId: 'price',

        operator: 'lte' as const,

        value: 30000,

        unit: null,
      },
    ],
  };
}

function nikeSearch() {
  return {
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
  };
}

describe('ConsultationWriteOwner pre-search CLARIFY', () => {
  it('validates and persists SearchSpec without calling search', async () => {
    const store = new InMemoryStore();

    const search = new FakeSearchPort();

    const owner = new ConsultationWriteOwner(
      store,

      search,

      {
        createExecutionId: () => 'execution-1',

        createResultId: () => 'result-1',
      },
    );

    const result = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-1',

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: weddingSuitSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      expectedResultId: null,
    });

    expect(result.status).toBe('accepted');

    expect(search.validateCalls).toBe(1);

    expect(search.searchCalls).toBe(0);

    expect(result.record.state?.search).toEqual({
      version: 1,

      ...weddingSuitSearch(),
    });

    expect(result.record.results.pendingSearch).toBeNull();

    expect(result.record.results.active).toBeNull();

    expect(result.record.processedRequestIds).toEqual(['request-1']);
  });

  it('detaches old active result when CLARIFY changes authoritative SearchSpec', async () => {
    const store = new InMemoryStore();

    const search = new FakeSearchPort();

    let execution = 0;

    let resultId = 0;

    const owner = new ConsultationWriteOwner(
      store,

      search,

      {
        createExecutionId: () => `execution-${++execution}`,

        createResultId: () => `result-${++resultId}`,
      },
    );

    /**
     * Сначала обычный реальный search.
     */
    const searched = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-search',

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: nikeSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      expectedResultId: null,
    });

    expect(searched.status).toBe('search_succeeded');

    expect(searched.record.results.active?.resultId).toBe('result-1');

    const oldResult = searched.record.results.active;

    expect(oldResult).not.toBeNull();

    /**
     * Пользователь добавил понятное
     * hard condition,
     * но перед новым search
     * нужен ещё вопрос.
     */
    const clarified = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: searched.record.revision,

      requestId: 'request-clarify',

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: {
          semanticIntent: 'мужские кроссовки Nike',

          category: 'SHOES',

          constraints: [
            ...nikeSearch().constraints,

            {
              attributeId: 'price',

              operator: 'lte',

              value: 20000,

              unit: null,
            },
          ],
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      expectedResultId: oldResult!.resultId,
    });

    expect(clarified.status).toBe('accepted');

    /**
     * НОВОГО поиска нет.
     */
    expect(search.searchCalls).toBe(1);

    /**
     * Но новый SearchSpec
     * Store adapter проверил.
     */
    expect(search.validateCalls).toBe(2);

    /**
     * Старые cards больше
     * не соответствуют current SearchSpec.
     */
    expect(clarified.record.results.active).toBeNull();

    /**
     * Snapshot не уничтожаем:
     * остаётся lastConfirmed.
     */
    expect(clarified.record.results.lastConfirmed?.resultId).toBe('result-1');

    expect(clarified.record.state?.search?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributeId: 'price',

          operator: 'lte',

          value: 20000,
        }),
      ]),
    );
  });

  it('keeps active result when CLARIFY persists exactly the same SearchSpec', async () => {
    const store = new InMemoryStore();

    const search = new FakeSearchPort();

    const owner = new ConsultationWriteOwner(
      store,

      search,

      {
        createExecutionId: () => 'execution-1',

        createResultId: () => 'result-1',
      },
    );

    const searched = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-search',

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: nikeSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      expectedResultId: null,
    });

    const clarified = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: searched.record.revision,

      requestId: 'request-clarify',

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: nikeSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      expectedResultId: searched.record.results.active?.resultId ?? null,
    });

    expect(clarified.record.results.active?.resultId).toBe('result-1');

    expect(search.searchCalls).toBe(1);
  });

  it('does not persist pre-search conditions rejected by Store validation', async () => {
    const store = new InMemoryStore();

    const search = new FakeSearchPort();

    search.failValidation = true;

    const owner = new ConsultationWriteOwner(
      store,

      search,
    );

    await expect(
      owner.execute({
        conversationId: 'conversation-1',

        expectedRevision: 0,

        requestId: 'request-1',

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'start_new',

          search: weddingSuitSearch(),

          searchPatch: null,

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        expectedResultId: null,
      }),
    ).rejects.toThrow('SearchSpec is not executable by store.');

    expect(search.searchCalls).toBe(0);

    expect(await store.load('conversation-1')).toBeNull();
  });
});
