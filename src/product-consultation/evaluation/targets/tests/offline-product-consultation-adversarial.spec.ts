import { describe, expect, it } from '@jest/globals';

import { resolve } from 'node:path';

import { ConsultationApplicationRecordSchema } from '../../../application/runtime/consultation-application-record';

import { EvaluationScenarioSchema } from '../../contracts/evaluation-scenario';

import { loadCurrentProductConsultationFixture } from '../../fixtures/current-product-consultation.fixture';

import { recordEvaluationScenario } from '../../run-evaluations';

import { OfflineProductConsultationTarget } from '../offline-product-consultation.target';

const fixturePath = resolve(
  process.cwd(),

  'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
);

const nikeSearchProposal = {
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

      {
        attributeId: 'type',

        operator: 'eq',

        value: 'SHOES',

        unit: null,
      },

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
} as const;

describe('OfflineProductConsultationTarget adversarial flow', () => {
  it('rejects a product reference bound to an unavailable result snapshot', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const scenario = EvaluationScenarioSchema.parse({
      id: 'OFFLINE-WRONG-SNAPSHOT',

      title: 'Wrong result snapshot',

      description:
        'DETAILS must not resolve positions through a stale or foreign resultId.',

      target: 'product_consultation',

      fixtureId: fixture.id,

      initialState: null,

      turns: [
        {
          id: 'T1',

          kind: 'message',

          message: 'Найди мужские Nike',

          messageId: 'wrong-snapshot-t1',
        },

        {
          id: 'T2',

          kind: 'message',

          message: 'Покажи первый подробнее',

          messageId: 'wrong-snapshot-t2',
        },
      ],

      checks: [],

      tags: ['offline', 'adversarial', 'wrong-snapshot'],
    });

    const target = new OfflineProductConsultationTarget(
      fixture,

      {
        T1: nikeSearchProposal,

        T2: {
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
      },

      {
        /**
         * T1 создаст result-T1.
         *
         * Но server context T2
         * намеренно указывает
         * несуществующий snapshot.
         */
        expectedResultIdByTurn: {
          T2: 'result-from-old-context',
        },
      },
    );

    const observation = await recordEvaluationScenario({
      scenario,

      target,
    });

    expect(observation.turns).toHaveLength(2);

    const searchTurn = observation.turns[0]!;

    expect(searchTurn.outcome).toBe('answer');

    const stateAfterSearch = ConsultationApplicationRecordSchema.parse(
      searchTurn.stateAfter,
    );

    expect(stateAfterSearch.results.active?.resultId).toBe('result-T1');

    const detailsTurn = observation.turns[1]!;

    /**
     * Boundary отвергает reference
     * до details/search/tool calls.
     */
    expect(detailsTurn.outcome).toBe('technical_failure');

    expect(detailsTurn.errors).toEqual([
      expect.objectContaining({
        message:
          'ConsultationResults: result snapshot result-from-old-context is not available.',
      }),
    ]);

    expect(detailsTurn.toolCalls).toEqual([]);

    expect(detailsTurn.artifacts).toEqual([]);

    /**
     * Неудачный stale reference
     * вообще не меняет aggregate.
     */
    expect(detailsTurn.stateAfter).toEqual(detailsTurn.stateBefore);

    const final = ConsultationApplicationRecordSchema.parse(
      observation.finalState,
    );

    expect(final.results.active?.resultId).toBe('result-T1');

    expect(final.processedRequestIds).toEqual(['wrong-snapshot-t1']);
  });

  it('rejects a profile-valid hard constraint that the current store cannot execute', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const scenario = EvaluationScenarioSchema.parse({
      id: 'OFFLINE-UNSUPPORTED-FILTER',

      title: 'Unsupported hard filter',

      description:
        'Store capability validation must reject unsupported SearchSpec before persistence or network search.',

      target: 'product_consultation',

      fixtureId: fixture.id,

      initialState: null,

      turns: [
        {
          id: 'T1',

          kind: 'message',

          message: 'Найди обувь весом до одного килограмма',

          messageId: 'unsupported-filter-t1',
        },
      ],

      checks: [],

      tags: ['offline', 'adversarial', 'unsupported-filter'],
    });

    const target = new OfflineProductConsultationTarget(
      fixture,

      {
        T1: {
          action: 'SEARCH',

          taskTransition: 'start_new',

          search: {
            semanticIntent: 'лёгкая обувь',

            category: 'SHOES',

            constraints: [
              {
                /**
                 * SHOES profile знает
                 * атрибут weight.
                 *
                 * Но current-store
                 * search adapter его
                 * пока не исполняет.
                 */
                attributeId: 'weight',

                operator: 'lte',

                value: 1,

                unit: 'kg',
              },
            ],
          },

          searchPatch: null,

          memoryObservations: [],

          selection: null,

          feedback: null,
        },
      },
    );

    const observation = await recordEvaluationScenario({
      scenario,

      target,
    });

    expect(observation.turns).toHaveLength(1);

    const turn = observation.turns[0]!;

    expect(turn.outcome).toBe('technical_failure');

    expect(turn.errors).toHaveLength(1);

    expect(turn.errors[0]?.message).toContain('weight');

    /**
     * Capability preflight происходит
     * до persistent state mutation
     * и до network search.
     */
    expect(turn.stateBefore).toBeNull();

    expect(turn.stateAfter).toBeNull();

    expect(observation.finalState).toBeNull();

    expect(
      turn.toolCalls.filter((call) => call.name === 'search_products'),
    ).toHaveLength(0);

    expect(turn.artifacts).toEqual([]);
  });

  it('distinguishes technical search failure from successful zero results', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const scenario = EvaluationScenarioSchema.parse({
      id: 'OFFLINE-SEARCH-FAILURE',

      title: 'Technical search failure',

      description:
        'A thrown search execution must become search_failed, not an empty successful result.',

      target: 'product_consultation',

      fixtureId: fixture.id,

      initialState: null,

      turns: [
        {
          id: 'T1',

          kind: 'message',

          message: 'Запусти технически падающий offline search',

          messageId: 'search-failure-t1',
        },
      ],

      checks: [],

      tags: ['offline', 'adversarial', 'search-failure'],
    });

    const target = new OfflineProductConsultationTarget(
      fixture,

      {
        T1: {
          ...nikeSearchProposal,

          /**
           * Hard filters валидны,
           * поэтому preflight проходит.
           *
           * Но такого semantic query
           * специально нет в frozen
           * fixture — search execution
           * бросит exception.
           */
          search: {
            ...nikeSearchProposal.search,

            semanticIntent: 'offline forced technical failure',
          },
        },
      },
    );

    const observation = await recordEvaluationScenario({
      scenario,

      target,
    });

    expect(observation.turns).toHaveLength(1);

    const turn = observation.turns[0]!;

    expect(turn.outcome).toBe('technical_failure');

    /**
     * Сам search реально запускался.
     */
    const searchCalls = turn.toolCalls.filter(
      (call) => call.name === 'search_products',
    );

    expect(searchCalls).toHaveLength(1);

    expect(searchCalls[0]?.error).not.toBeNull();

    expect(turn.resultMetadata).toEqual(
      expect.objectContaining({
        status: 'search_failed',

        activeResultId: null,

        activeProductCount: null,
      }),
    );

    const failed = ConsultationApplicationRecordSchema.parse(turn.stateAfter);

    /**
     * SearchSpec остаётся:
     * backend знает, что пользователь
     * пытался искать именно это.
     */
    expect(failed.state?.search?.semanticIntent).toBe(
      'offline forced technical failure',
    );

    /**
     * Но успешного snapshot нет.
     */
    expect(failed.results.pendingSearch).toBeNull();

    expect(failed.results.active).toBeNull();

    expect(failed.results.lastConfirmed).toBeNull();

    expect(
      turn.artifacts.filter((artifact) => artifact.kind === 'search_results'),
    ).toHaveLength(0);

    /**
     * Это принципиально отличается
     * от zero-result search.
     *
     * В основном vertical flow
     * green Nike / green Adidas /
     * women clothes создают
     * успешный active snapshot
     * с products=[].
     */
  });
});
