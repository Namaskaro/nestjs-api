import { describe, expect, it, jest } from '@jest/globals';

import type { ProductDetailsPort } from '../../catalog/product-details.port';

import type {
  ProductConsultantModelInput,
  ProductConsultantModelPort,
} from '../product-consultant-model.port';

import { ProductConsultantLoop } from '../product-consultant-loop';

import type { ProductSearchPort } from '../../search/product-search.port';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../../runtime/consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from '../../runtime/consultation-application-store.port';

import { ConsultationWriteOwner } from '../../runtime/consultation-write-owner';

class InMemoryStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord | null = null;

  public async load(
    _conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    return this.record === null
      ? null
      : ConsultationApplicationRecordSchema.parse(structuredClone(this.record));
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

    this.record = ConsultationApplicationRecordSchema.parse(
      structuredClone(input.record),
    );
  }
}

class QueuedModel implements ProductConsultantModelPort {
  public readonly calls: ProductConsultantModelInput[] = [];

  constructor(private readonly decisions: readonly unknown[]) {}

  public async decide(input: ProductConsultantModelInput): Promise<unknown> {
    this.calls.push(input);

    const decision = this.decisions[this.calls.length - 1];

    if (decision === undefined) {
      throw new Error('QueuedModel: no decision.');
    }

    return structuredClone(decision);
  }
}

function clarifyDecision() {
  return {
    proposal: {
      action: 'CLARIFY',

      taskTransition: 'start_new',

      search: {
        semanticIntent: 'мужские кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'gender',

            operator: 'eq',

            value: 'MAN',

            unit: null,
          },
        ],
      },

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: 'Для чего в основном нужны кроссовки?',
  };
}

function createRuntime(decisions: readonly unknown[]) {
  const store = new InMemoryStore();

  const validate = jest.fn();

  const search = jest.fn(async () => []);

  const productSearch: ProductSearchPort = {
    validate,

    search,
  };

  const getProductDetails = jest.fn(async () => []);

  const productDetails: ProductDetailsPort = {
    getProductDetails,
  };

  const writeOwner = new ConsultationWriteOwner(
    store,

    productSearch,

    {
      createExecutionId: () => 'execution-1',

      createResultId: () => 'result-1',
    },
  );

  const model = new QueuedModel(decisions);

  const loop = new ProductConsultantLoop(
    store,

    writeOwner,

    productDetails,

    model,
  );

  return {
    store,

    loop,

    model,

    validate,

    search,

    getProductDetails,
  };
}

describe('ProductConsultantLoop request idempotency', () => {
  it('returns duplicate before LLM or catalog capabilities are called', async () => {
    const runtime = createRuntime([clarifyDecision()]);

    const first = await runtime.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Нужны мужские кроссовки',
    });

    expect(first.outcome).toBe('completed');

    expect(first.modelCalls).toBe(1);

    expect(first.record.processedRequestIds).toEqual(['message-1']);

    expect(runtime.model.calls).toHaveLength(1);

    expect(runtime.validate).toHaveBeenCalledTimes(1);

    expect(runtime.search).not.toHaveBeenCalled();

    expect(runtime.getProductDetails).not.toHaveBeenCalled();

    const revisionBeforeDuplicate = first.record.revision;

    /**
     * В модели больше НЕТ queued decision.
     *
     * Если duplicate check окажется
     * после LLM, этот тест сразу упадёт.
     */
    const duplicate = await runtime.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Нужны мужские кроссовки',
    });

    expect(duplicate.outcome).toBe('duplicate_request');

    expect(duplicate.text).toBe('');

    expect(duplicate.modelCalls).toBe(0);

    expect(duplicate.capabilityRounds).toBe(0);

    expect(duplicate.artifacts).toEqual([]);

    expect(duplicate.record.revision).toBe(revisionBeforeDuplicate);

    expect(duplicate.record.processedRequestIds).toEqual(['message-1']);

    /**
     * Никакая внешняя capability
     * повторно не вызвана.
     */
    expect(runtime.model.calls).toHaveLength(1);

    expect(runtime.validate).toHaveBeenCalledTimes(1);

    expect(runtime.search).not.toHaveBeenCalled();

    expect(runtime.getProductDetails).not.toHaveBeenCalled();
  });

  it('normalizes requestId before duplicate lookup', async () => {
    const runtime = createRuntime([clarifyDecision()]);

    await runtime.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Нужны мужские кроссовки',
    });

    const duplicate = await runtime.loop.run({
      conversationId: 'conversation-1',

      requestId: '   message-1   ',

      currentMessage: 'Нужны мужские кроссовки',
    });

    expect(duplicate.outcome).toBe('duplicate_request');

    expect(duplicate.modelCalls).toBe(0);

    expect(runtime.model.calls).toHaveLength(1);
  });

  it('does not mark a request as processed when model fails before WriteOwner', async () => {
    const runtime = createRuntime([
      {
        invalid: 'structured output',
      },

      clarifyDecision(),
    ]);

    const failed = await runtime.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Нужны мужские кроссовки',
    });

    expect(failed.outcome).toBe('interpretation_error');

    expect(failed.record.processedRequestIds).toEqual([]);

    /**
     * Тот же requestId можно
     * корректно повторить,
     * потому что authoritative
     * write ещё не происходил.
     */
    const retry = await runtime.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Нужны мужские кроссовки',
    });

    expect(retry.outcome).toBe('completed');

    expect(retry.record.processedRequestIds).toEqual(['message-1']);

    expect(runtime.model.calls).toHaveLength(2);
  });
});
