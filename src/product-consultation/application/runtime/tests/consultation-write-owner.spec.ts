import { describe, expect, it, jest } from '@jest/globals';

import type { ConsultationResultProduct } from '../../../core/results/consultation-results.schema';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
} from '../../../core/results/consultation-results';

import { createSearchSpec } from '../../../core/search/search-spec';

import type { SearchSpec } from '../../../core/search/search-spec.schema';

import { createProductConsultationState } from '../../../core/state/consultation-state';

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
  value: ConsultationApplicationRecord,
): ConsultationApplicationRecord {
  return ConsultationApplicationRecordSchema.parse(structuredClone(value));
}

class InMemoryConsultationStore implements ConsultationApplicationStore {
  private readonly records = new Map<string, ConsultationApplicationRecord>();

  public async load(
    conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    const record = this.records.get(conversationId);

    return record ? cloneRecord(record) : null;
  }

  public async saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void> {
    const current = this.records.get(input.conversationId);

    const actualRevision = current?.revision ?? 0;

    if (actualRevision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,

        input.expectedRevision,

        current?.revision ?? null,
      );
    }

    expect(input.record.revision).toBe(input.expectedRevision + 1);

    this.records.set(
      input.conversationId,

      cloneRecord(input.record),
    );
  }
}

function nikeProposal() {
  return {
    action: 'SEARCH' as const,

    taskTransition: 'start_new' as const,

    search: {
      semanticIntent: 'городские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq' as const,

          value: 'MAN',

          unit: null,
        },

        {
          attributeId: 'type',

          operator: 'eq' as const,

          value: 'SHOES',

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

function adidasRefineProposal() {
  return {
    action: 'REFINE' as const,

    taskTransition: 'continue' as const,

    search: null,

    searchPatch: {
      set: [
        {
          attributeId: 'brand',

          operator: 'eq' as const,

          value: 'Adidas',

          unit: null,
        },
      ],

      clear: [],
    },

    memoryObservations: [],

    selection: null,

    feedback: null,
  };
}

function newClarifyProposal(goal = 'платье на свадьбу') {
  return {
    action: 'CLARIFY' as const,

    taskTransition: 'start_new' as const,

    search: null,

    searchPatch: null,

    memoryObservations: [
      {
        kind: 'goal' as const,

        operation: 'remember' as const,

        text: goal,

        importance: 'high' as const,

        sourceText: goal,
      },
    ],

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

function deferred<T>() {
  let resolve!: (value: T) => void;

  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;

    reject = rejectPromise;
  });

  return {
    promise,

    resolve,

    reject,
  };
}

function brandFromSearch(search: SearchSpec): string | null {
  const constraint = search.constraints.find(
    (item) => item.attributeId === 'brand' && item.operator === 'eq',
  );

  return typeof constraint?.value === 'string' ? constraint.value : null;
}

describe('ConsultationWriteOwner', () => {
  it('persists pending search before network execution and then commits result', async () => {
    const store = new InMemoryConsultationStore();

    let observedPendingExecution: string | null = null;

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(
        async (_search: SearchSpec): Promise<ConsultationResultProduct[]> => {
          const persisted = await store.load('conversation-1');

          observedPendingExecution =
            persisted?.results.pendingSearch?.executionId ?? null;

          return [product('nike-1')];
        },
      ),
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createExecutionId: () => 'execution-1',

        createResultId: () => 'result-1',
      },
    );

    const result = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-1',

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    expect(observedPendingExecution).toBe('execution-1');

    expect(result.status).toBe('search_succeeded');

    expect(result.record.results.pendingSearch).toBeNull();

    expect(result.record.results.active?.resultId).toBe('result-1');

    expect(result.record.results.active?.products).toEqual([product('nike-1')]);

    expect(result.record.generation).toBe(1);
  });

  it('start_new invalidates old pending search and rejects its late result', async () => {
    const store = new InMemoryConsultationStore();

    const searchResult = deferred<ConsultationResultProduct[]>();

    const enteredSearch = deferred<void>();

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(
        async (_search: SearchSpec): Promise<ConsultationResultProduct[]> => {
          enteredSearch.resolve();

          return searchResult.promise;
        },
      ),
    };

    let executionCounter = 0;

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createExecutionId: () => `execution-${++executionCounter}`,

        createResultId: () => 'late-result',
      },
    );

    const first = owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-nike',

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    await enteredSearch.promise;

    const beforeNewTask = await store.load('conversation-1');

    if (!beforeNewTask) {
      throw new Error('Expected persisted pending search.');
    }

    expect(beforeNewTask.results.pendingSearch?.executionId).toBe(
      'execution-1',
    );

    expect(beforeNewTask.generation).toBe(1);

    const second = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: beforeNewTask.revision,

      requestId: 'request-dress',

      proposal: newClarifyProposal(),

      expectedResultId: null,
    });

    expect(second.status).toBe('accepted');

    expect(second.record.generation).toBe(2);

    expect(second.record.state?.search).toBeNull();

    expect(second.record.results.pendingSearch).toBeNull();

    expect(second.record.results.active).toBeNull();

    expect(second.record.results.lastConfirmed).toBeNull();

    searchResult.resolve([product('nike-late')]);

    const firstResult = await first;

    expect(firstResult.status).toBe('superseded');

    const final = await store.load('conversation-1');

    expect(final?.generation).toBe(2);

    expect(final?.state?.search).toBeNull();

    expect(final?.results.active).toBeNull();

    expect(final?.results.lastConfirmed).toBeNull();

    expect(final?.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'платье на свадьбу',
      }),
    ]);
  });

  it('does not execute the same request twice', async () => {
    const store = new InMemoryConsultationStore();

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
        createExecutionId: () => 'execution-1',

        createResultId: () => 'result-1',
      },
    );

    const first = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'same-request',

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    expect(first.status).toBe('search_succeeded');

    /**
     * Намеренно оставляем
     * expectedRevision=0.
     *
     * Повторная доставка того же
     * request должна распознаться
     * как duplicate раньше,
     * чем stale-context check.
     */
    const second = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'same-request',

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    expect(second.status).toBe('duplicate');

    expect(search).toHaveBeenCalledTimes(1);

    expect(second.record.revision).toBe(first.record.revision);
  });

  it('rejects unsupported search before state or pending execution is persisted', async () => {
    const store = new InMemoryConsultationStore();

    const search = jest.fn(
      async (): Promise<ConsultationResultProduct[]> => [],
    );

    const productSearch: ProductSearchPort = {
      validate: jest.fn(() => {
        throw new Error('unsupported hard constraint weight:lte');
      }),

      search,
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,
    );

    await expect(
      owner.execute({
        conversationId: 'conversation-1',

        expectedRevision: 0,

        requestId: 'request-1',

        proposal: nikeProposal(),

        expectedResultId: null,
      }),
    ).rejects.toThrow('unsupported hard constraint weight:lte');

    expect(search).not.toHaveBeenCalled();

    expect(await store.load('conversation-1')).toBeNull();
  });

  it('records technical search failure without creating a successful snapshot', async () => {
    const store = new InMemoryConsultationStore();

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(async () => {
        throw new Error('Qdrant unavailable');
      }),
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

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    expect(result.status).toBe('search_failed');

    expect(result.record.results.pendingSearch).toBeNull();

    expect(result.record.results.active).toBeNull();

    expect(result.record.results.lastConfirmed).toBeNull();

    expect(result.record.state?.search).not.toBeNull();
  });

  it('commits successful zero-result search as an active empty snapshot', async () => {
    const store = new InMemoryConsultationStore();

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(async (): Promise<ConsultationResultProduct[]> => []),
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createExecutionId: () => 'execution-zero',

        createResultId: () => 'result-zero',
      },
    );

    const result = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-zero',

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    expect(result.status).toBe('search_succeeded');

    expect(result.record.results.active?.resultId).toBe('result-zero');

    expect(result.record.results.active?.products).toEqual([]);

    expect(result.record.results.lastConfirmed?.resultId).toBe('result-zero');
  });

  it('uses optimistic concurrency so two concurrent turns cannot both overwrite the same conversation revision', async () => {
    const store = new InMemoryConsultationStore();

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(async (): Promise<ConsultationResultProduct[]> => []),
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,
    );

    const first = owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-a',

      proposal: newClarifyProposal('платье на свадьбу'),

      expectedResultId: null,
    });

    const second = owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-b',

      proposal: newClarifyProposal('костюм на мероприятие'),

      expectedResultId: null,
    });

    const settled = await Promise.allSettled([first, second]);

    const fulfilled = settled.filter(
      (item): item is PromiseFulfilledResult<Awaited<typeof first>> =>
        item.status === 'fulfilled',
    );

    const rejected = settled.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);

    expect(rejected).toHaveLength(1);

    expect(rejected[0]?.reason).toBeInstanceOf(ConsultationWriteConflictError);

    const persisted = await store.load('conversation-1');

    expect(persisted?.revision).toBe(1);

    expect(persisted?.generation).toBe(1);

    expect(persisted?.processedRequestIds).toHaveLength(1);

    expect(persisted?.processedRequestIds[0]).toMatch(/^request-[ab]$/);

    expect(persisted?.state?.memory.memory.goals).toHaveLength(1);
  });

  it('rejects late E1 when newer E2 search starts inside the same task generation', async () => {
    const store = new InMemoryConsultationStore();

    const firstSearchResult = deferred<ConsultationResultProduct[]>();

    const enteredFirstSearch = deferred<void>();

    let searchCall = 0;

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(
        async (search: SearchSpec): Promise<ConsultationResultProduct[]> => {
          searchCall += 1;

          const brand = brandFromSearch(search);

          if (searchCall === 1) {
            expect(brand).toBe('Nike');

            enteredFirstSearch.resolve();

            return firstSearchResult.promise;
          }

          expect(searchCall).toBe(2);

          expect(brand).toBe('Adidas');

          return [product('adidas-1')];
        },
      ),
    };

    let executionCounter = 0;

    let resultCounter = 0;

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,

      {
        createExecutionId: () => `execution-${++executionCounter}`,

        createResultId: () => `result-${++resultCounter}`,
      },
    );

    const first = owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'request-nike',

      proposal: nikeProposal(),

      expectedResultId: null,
    });

    await enteredFirstSearch.promise;

    const afterE1Started = await store.load('conversation-1');

    if (!afterE1Started) {
      throw new Error('Expected E1 pending search.');
    }

    expect(afterE1Started.generation).toBe(1);

    expect(afterE1Started.results.pendingSearch?.executionId).toBe(
      'execution-1',
    );

    const second = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: afterE1Started.revision,

      requestId: 'request-adidas',

      proposal: adidasRefineProposal(),

      expectedResultId: null,
    });

    expect(second.status).toBe('search_succeeded');

    expect(second.record.generation).toBe(1);

    expect(second.record.results.pendingSearch).toBeNull();

    expect(second.record.results.active?.executionId).toBe('execution-2');

    expect(second.record.results.active?.products).toEqual([
      product('adidas-1'),
    ]);

    expect(brandFromSearch(second.record.state!.search!)).toBe('Adidas');

    firstSearchResult.resolve([product('nike-late')]);

    const firstFinished = await first;

    expect(firstFinished.status).toBe('superseded');

    const final = await store.load('conversation-1');

    expect(final?.generation).toBe(1);

    expect(final?.results.active?.executionId).toBe('execution-2');

    expect(final?.results.active?.products).toEqual([product('adidas-1')]);

    expect(final?.results.active?.products).not.toContainEqual(
      product('nike-late'),
    );

    expect(brandFromSearch(final!.state!.search!)).toBe('Adidas');

    expect(final?.processedRequestIds).toEqual([
      'request-nike',

      'request-adidas',
    ]);
  });

  it('rejects a proposal created from an older context revision', async () => {
    const store = new InMemoryConsultationStore();

    const productSearch: ProductSearchPort = {
      validate: jest.fn(),

      search: jest.fn(async (): Promise<ConsultationResultProduct[]> => []),
    };

    const owner = new ConsultationWriteOwner(
      store,

      productSearch,
    );

    const first = await owner.execute({
      conversationId: 'conversation-1',

      expectedRevision: 0,

      requestId: 'fresh-request',

      proposal: newClarifyProposal('платье на свадьбу'),

      expectedResultId: null,
    });

    expect(first.record.revision).toBe(1);

    /**
     * Представим, что второй proposal
     * был сформирован ещё тогда,
     * когда Consultant видел revision=0.
     *
     * Но authoritative record
     * уже revision=1.
     */
    await expect(
      owner.execute({
        conversationId: 'conversation-1',

        expectedRevision: 0,

        requestId: 'stale-request',

        proposal: newClarifyProposal('костюм на мероприятие'),

        expectedResultId: null,
      }),
    ).rejects.toBeInstanceOf(ConsultationWriteConflictError);

    const persisted = await store.load('conversation-1');

    expect(persisted?.revision).toBe(1);

    expect(persisted?.processedRequestIds).toEqual(['fresh-request']);

    expect(persisted?.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'платье на свадьбу',
      }),
    ]);
  });

  it('rejects application state whose active results belong to another SearchSpec', () => {
    const clothesState = createProductConsultationState({
      semanticIntent: 'женские платья',

      category: 'CLOTHES',

      constraints: [],
    });

    const shoesSearch = createSearchSpec({
      semanticIntent: 'мужские кроссовки',

      category: 'SHOES',

      constraints: [],
    });

    const started = beginSearchExecution(
      createConsultationResultsState(),

      shoesSearch,

      () => 'execution-shoes',
    );

    const shoesResults = commitSearchExecution(
      started.state,

      started.executionId,

      [],

      () => 'result-shoes',
    );

    /**
     * State говорит:
     *
     * CLOTHES
     *
     * active Results говорят:
     *
     * SHOES
     *
     * Такой aggregate не должен
     * пройти application boundary.
     */
    expect(() =>
      ConsultationApplicationRecordSchema.parse({
        version: 1,

        revision: 2,

        generation: 1,

        state: clothesState,

        results: shoesResults,

        processedRequestIds: [],
      }),
    ).toThrow(
      'active SearchSpec does not match authoritative state SearchSpec',
    );
  });
});
