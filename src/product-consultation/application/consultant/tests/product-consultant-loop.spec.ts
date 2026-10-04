import { describe, expect, it } from '@jest/globals';

import { resolve } from 'node:path';

import { CurrentStoreSearchSpecAdapter } from '../../../adapters/current-store/current-store-search-spec.adapter';

import type { ProductDetailsPort } from '../../catalog/product-details.port';

import type { UsageScenarioSelectionDiagnostic } from '../../../core/profiles/usage-scenarios';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../../runtime/consultation-application-record';

import type { ConsultationApplicationStore } from '../../runtime/consultation-application-store.port';

import { ConsultationWriteOwner } from '../../runtime/consultation-write-owner';

import {
  FrozenCurrentProductCatalog,
  loadCurrentProductConsultationFixture,
} from '../../../evaluation/fixtures/current-product-consultation.fixture';

import type {
  ProductConsultantModelInput,
  ProductConsultantModelPort,
} from '../product-consultant-model.port';

import {
  ProductConsultantLoop,
  type ProductConsultantLoopOptions,
} from '../product-consultant-loop';

const fixturePath = resolve(
  process.cwd(),

  'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
);

class InMemoryConsultationStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord | null = null;

  public async load(
    _conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    return this.record
      ? ConsultationApplicationRecordSchema.parse(structuredClone(this.record))
      : null;
  }

  public async saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void> {
    const actual = this.record?.revision ?? 0;

    if (actual !== input.expectedRevision) {
      throw new Error(
        `Revision mismatch: expected=${input.expectedRevision}, actual=${actual}`,
      );
    }

    this.record = ConsultationApplicationRecordSchema.parse(
      structuredClone(input.record),
    );
  }
}

class StubProductConsultantModel implements ProductConsultantModelPort {
  public readonly calls: ProductConsultantModelInput[] = [];

  constructor(private readonly decisions: unknown[]) {}

  public async decide(input: ProductConsultantModelInput): Promise<unknown> {
    this.calls.push({
      ...input,

      context: structuredClone(input.context),

      observation: structuredClone(input.observation),
    });

    const decision = this.decisions[this.calls.length - 1];

    if (decision === undefined) {
      throw new Error('StubProductConsultantModel: no queued decision.');
    }

    return structuredClone(decision);
  }
}

function searchNikeDecision() {
  return {
    proposal: {
      action: 'SEARCH',

      taskTransition: 'start_new',

      search: {
        semanticIntent: 'мужские кроссовки Nike',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'gender',

            operator: 'eq',

            value: 'MAN',

            unit: null,
          },

          /**
           * B3 regression:
           *
           * type:eq SHOES модели
           * больше передавать не нужно.
           */
          {
            attributeId: 'brand',

            operator: 'eq',

            value: 'Nike',

            unit: null,
          },
        ],
      },

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    },

    usageScenarioIds: ['daily_walking'],

    factAttributeIds: [],

    terminalText: null,
  };
}

function complete(text: string) {
  return {
    proposal: {
      action: 'COMPLETE',

      taskTransition: 'continue',

      search: null,

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    },

    usageScenarioIds: [],

    factAttributeIds: [],

    terminalText: text,
  };
}

async function createRuntime() {
  const fixture = await loadCurrentProductConsultationFixture(fixturePath);

  const catalog = new FrozenCurrentProductCatalog(fixture);

  let searchCalls = 0;

  let detailsCalls = 0;

  const baseSearch = new CurrentStoreSearchSpecAdapter(catalog);

  const searchPort = {
    validate(search: Parameters<typeof baseSearch.validate>[0]) {
      return baseSearch.validate(search);
    },

    async search(search: Parameters<typeof baseSearch.search>[0]) {
      searchCalls += 1;

      return baseSearch.search(search);
    },
  };

  const productDetails: ProductDetailsPort = {
    async getProductDetails(productIds) {
      detailsCalls += 1;

      return catalog.getProductDetails(productIds);
    },
  };

  const store = new InMemoryConsultationStore();

  let memoryId = 0;

  let executionId = 0;

  let resultId = 0;

  const writeOwner = new ConsultationWriteOwner(
    store,

    searchPort,

    {
      createMemoryId: () => `memory-${++memoryId}`,

      createExecutionId: () => `execution-${++executionId}`,

      createResultId: () => `result-${++resultId}`,
    },
  );

  function createLoop(
    decisions: unknown[],

    options: ProductConsultantLoopOptions = {},
  ) {
    const model = new StubProductConsultantModel(decisions);

    const loop = new ProductConsultantLoop(
      store,

      writeOwner,

      productDetails,

      model,

      {
        searchCapabilities: baseSearch.capabilities(),

        ...options,
      },
    );

    return {
      model,

      loop,
    };
  }

  return {
    store,

    createLoop,

    getSearchCalls: () => searchCalls,

    getDetailsCalls: () => detailsCalls,
  };
}

describe('ProductConsultantLoop', () => {
  it('runs SEARCH, reads bounded verified facts and finishes through second model call', async () => {
    const runtime = await createRuntime();

    const { loop, model } = runtime.createLoop([
      searchNikeDecision(),

      complete('Нашёл три мужские модели Nike.'),
    ]);

    const result = await loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Найди мужские кроссовки Nike',
    });

    expect(result.outcome).toBe('completed');

    expect(result.modelCalls).toBe(2);

    expect(result.capabilityRounds).toBe(1);

    expect(runtime.getSearchCalls()).toBe(1);

    /**
     * S4:
     *
     * SEARCH теперь делает один
     * bounded details read.
     */
    expect(runtime.getDetailsCalls()).toBe(1);

    expect(result.artifacts).toHaveLength(1);

    expect(model.calls[1]?.observation).toEqual({
      kind: 'search',

      status: 'succeeded',

      count: 3,
    });

    expect(model.calls[1]?.context.results.shownProducts).toHaveLength(3);

    /**
     * initialFactProducts = 3.
     */
    expect(model.calls[1]?.context.productFacts).toHaveLength(3);

    /**
     * Без explicit fact focus:
     *
     * daily_walking attrs идут раньше
     * profile defaults.
     */
    expect(
      model.calls[1]?.context.productFacts[0]?.facts.map(
        (fact) => fact.attributeId,
      ),
    ).toEqual([
      'purpose',

      'sole',

      'upperMaterial',

      'material',

      'price',

      'season',

      'sizes',
    ]);

    expect(result.record.processedRequestIds).toEqual(['message-1']);
  });

  it('prioritizes explicit fact focus before usage scenario and profile defaults', async () => {
    const runtime = await createRuntime();

    const decision = searchNikeDecision();

    decision.factAttributeIds = ['color'];

    const { loop, model } = runtime.createLoop([
      decision,

      complete('Нашёл варианты и проверил цвет.'),
    ]);

    const result = await loop.run({
      conversationId: 'conversation-fact-focus',

      requestId: 'message-fact-focus',

      currentMessage: 'Найди мужские Nike и скажи, какие у них цвета',
    });

    expect(result.outcome).toBe('completed');

    expect(runtime.getDetailsCalls()).toBe(1);

    const attributes = model.calls[1]?.context.productFacts[0]?.facts.map(
      (fact) => fact.attributeId,
    );

    expect(attributes?.[0]).toBe('color');

    expect(attributes).toEqual([
      'color',

      'purpose',

      'sole',

      'upperMaterial',

      'material',

      'price',

      'season',

      'sizes',
    ]);
  });

  it('passes compact store capabilities to both model rounds', async () => {
    const runtime = await createRuntime();

    const { loop, model } = runtime.createLoop([
      searchNikeDecision(),

      complete('Нашёл Nike.'),
    ]);

    await loop.run({
      conversationId: 'conversation-capabilities',

      requestId: 'message-capabilities',

      currentMessage: 'Найди мужские Nike',
    });

    for (const call of model.calls) {
      expect(call.context.searchCapabilities).not.toBeNull();

      const shoes = call.context.searchCapabilities?.profiles.find(
        (profile) => profile.profileId === 'SHOES',
      );

      expect(shoes).toBeDefined();

      expect(
        shoes?.attributes.some(
          (attribute) => attribute.attributeId === 'brand',
        ),
      ).toBe(true);

      expect(
        shoes?.attributes.some((attribute) => attribute.attributeId === 'type'),
      ).toBe(false);
    }
  });

  it('drops unknown optional usage scenario before WriteOwner and still executes valid search', async () => {
    const runtime = await createRuntime();

    const diagnostics: UsageScenarioSelectionDiagnostic[] = [];

    const decision = searchNikeDecision();

    decision.usageScenarioIds = ['daily_walking', 'invented_comfort_scenario'];

    const { loop, model } = runtime.createLoop(
      [decision, complete('Нашёл подходящие модели Nike.')],

      {
        onDiagnostic: (diagnostic) => {
          expect(runtime.getSearchCalls()).toBe(0);

          diagnostics.push(diagnostic);
        },
      },
    );

    const result = await loop.run({
      conversationId: 'conversation-usage-soft-failure',

      requestId: 'message-usage-soft-failure',

      currentMessage: 'Найди мужские Nike на каждый день',
    });

    expect(result.outcome).toBe('completed');

    expect(runtime.getSearchCalls()).toBe(1);

    expect(result.modelCalls).toBe(2);

    expect(result.capabilityRounds).toBe(1);

    expect(diagnostics).toEqual([
      {
        code: 'unknown_usage_scenario',

        scenarioId: 'invented_comfort_scenario',

        profileId: 'SHOES',
      },
    ]);

    expect(
      model.calls[1]?.context.usage?.selected.map((scenario) => scenario.id),
    ).toEqual(['daily_walking']);

    expect(
      model.calls[1]?.context.usage?.selected.some(
        (scenario) => scenario.id === 'invented_comfort_scenario',
      ),
    ).toBe(false);
  });

  it('does not let a broken diagnostic sink break a valid user request', async () => {
    const runtime = await createRuntime();

    const decision = searchNikeDecision();

    decision.usageScenarioIds = ['daily_walking', 'invented_scenario'];

    const { loop } = runtime.createLoop(
      [decision, complete('Нашёл варианты Nike.')],

      {
        onDiagnostic: () => {
          throw new Error('Tracing is temporarily unavailable.');
        },
      },
    );

    const result = await loop.run({
      conversationId: 'conversation-broken-diagnostic',

      requestId: 'message-broken-diagnostic',

      currentMessage: 'Найди Nike на каждый день',
    });

    expect(result.outcome).toBe('completed');

    expect(runtime.getSearchCalls()).toBe(1);
  });

  it('runs deterministic COMPARE in next user turn without another search', async () => {
    const runtime = await createRuntime();

    const search = runtime.createLoop([
      searchNikeDecision(),

      complete('Нашёл варианты Nike.'),
    ]);

    await search.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-1',

      currentMessage: 'Найди мужские кроссовки Nike',
    });

    expect(runtime.getSearchCalls()).toBe(1);

    const compare = runtime.createLoop([
      {
        proposal: {
          action: 'COMPARE',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: {
            kind: 'positions',

            positions: [1, 2],
          },

          feedback: null,
        },

        usageScenarioIds: ['daily_walking'],

        /**
         * S4:
         * сравнение можно сфокусировать
         * ephemeral attributes.
         */
        factAttributeIds: ['price', 'color'],

        terminalText: null,
      },

      complete(
        'Первый дешевле; по неизвестным характеристикам уверенный вывод делать нельзя.',
      ),
    ]);

    const result = await compare.loop.run({
      conversationId: 'conversation-1',

      requestId: 'message-2',

      currentMessage: 'Сравни первый и второй',
    });

    expect(result.outcome).toBe('completed');

    expect(runtime.getSearchCalls()).toBe(1);

    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      'product_comparison',
    ]);

    const comparison = compare.model.calls[1]?.context.comparison;

    expect(comparison).not.toBeNull();

    const price = comparison?.rows.find((row) => row.attributeId === 'price');

    expect(price?.state).toBe('numeric_difference');

    expect(price?.cells.map((cell) => cell.position)).toEqual([1, 2]);

    expect(JSON.stringify(comparison)).not.toContain(
      '27807943-51e2-49fd-a0eb-4f3cd6568177',
    );
  });

  it('rejects another capability request from model call #2 instead of recursive orchestration', async () => {
    const runtime = await createRuntime();

    const { loop } = runtime.createLoop([
      searchNikeDecision(),

      {
        proposal: {
          action: 'DETAILS',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: {
            kind: 'positions',

            positions: [1],
          },

          feedback: null,
        },

        usageScenarioIds: [],

        factAttributeIds: [],

        terminalText: null,
      },
    ]);

    const result = await loop.run({
      conversationId: 'conversation-budget',

      requestId: 'message-budget',

      currentMessage: 'Найди мужские кроссовки Nike',
    });

    expect(result.outcome).toBe('budget_exhausted');

    expect(result.modelCalls).toBe(2);

    expect(result.capabilityRounds).toBe(1);

    expect(runtime.getSearchCalls()).toBe(1);
  });

  it('persists terminal CLARIFY observations with one model call and no capability round', async () => {
    const runtime = await createRuntime();

    const { loop } = runtime.createLoop([
      {
        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'goal',

              operation: 'remember',

              text: 'для тренировок',

              importance: 'high',

              sourceText: 'Нужны для тренировок',
            },
          ],

          selection: null,

          feedback: null,
        },

        usageScenarioIds: [],

        factAttributeIds: [],

        terminalText:
          'Для каких тренировок нужна обувь: бег, зал или другая нагрузка?',
      },
    ]);

    const result = await loop.run({
      conversationId: 'conversation-clarify',

      requestId: 'message-clarify',

      currentMessage: 'Нужны для тренировок',
    });

    expect(result.outcome).toBe('completed');

    expect(result.modelCalls).toBe(1);

    expect(result.capabilityRounds).toBe(0);

    expect(runtime.getSearchCalls()).toBe(0);

    expect(result.record.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'для тренировок',

        importance: 'high',
      }),
    ]);
  });

  it('returns controlled interpretation error for invalid structured output without state mutation', async () => {
    const runtime = await createRuntime();

    const { loop } = runtime.createLoop([
      {
        nonsense: true,
      },
    ]);

    const result = await loop.run({
      conversationId: 'conversation-invalid',

      requestId: 'message-invalid',

      currentMessage: 'Найди что-нибудь',
    });

    expect(result.outcome).toBe('interpretation_error');

    expect(result.modelCalls).toBe(1);

    expect(result.capabilityRounds).toBe(0);

    expect(runtime.getSearchCalls()).toBe(0);

    expect(result.record.revision).toBe(0);

    expect(result.record.processedRequestIds).toEqual([]);
  });
});
