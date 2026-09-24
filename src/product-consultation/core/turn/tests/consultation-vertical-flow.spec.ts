import { describe, expect, it } from '@jest/globals';

import { CLOTHES_PROFILE } from '../../profiles/clothes.profile';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
  failSearchExecution,
} from '../../results/consultation-results';

import { findSearchConstraint } from '../../search/search-spec';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

describe('Product Consultation deterministic vertical flow', () => {
  it('runs search → refine → compare → feedback + recommend → new task → technical failure', () => {
    /**
     * =========================================================
     * 0. EMPTY CONSULTATION
     * =========================================================
     */

    let state = null;

    let results = createConsultationResultsState();

    /**
     * =========================================================
     * 1. USER:
     *
     * "Найди мужские кроссовки Nike"
     *
     * Новый независимый task.
     * =========================================================
     */

    const nikeSearch = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'SEARCH',

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

        /**
         * Semantic Memory observation.
         *
         * Public boundary получает
         * смысл наблюдения:
         *
         * "пользователь хочет
         * повседневную носку".
         *
         * Никакого goalId модель
         * сюда не передаёт.
         */
        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'повседневная носка',

            importance: 'normal',

            sourceText: 'нужны на каждый день',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'goal-daily',
    });

    state = nikeSearch.turn.state;

    expect(nikeSearch.turn.searchRequired).toBe(true);

    expect(state.search?.category).toBe('SHOES');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Nike');

    expect(state.memory.memory.goals).toEqual([
      {
        goalId: 'goal-daily',

        text: 'повседневная носка',

        importance: 'normal',

        sourceText: 'нужны на каждый день',
      },
    ]);

    /**
     * =========================================================
     * SEARCH EXECUTION: NIKE
     * =========================================================
     */

    const nikeExecution = beginSearchExecution(
      results,

      state.search!,

      () => 'execution-nike',
    );

    results = commitSearchExecution(
      nikeExecution.state,

      nikeExecution.executionId,

      [
        {
          productId: 'nike-dunk',

          title: 'Nike SB Dunk Low Pro',

          price: '15000',

          image: null,
        },

        {
          productId: 'nike-mind',

          title: 'Nike Mind 002',

          price: '23000',

          image: null,
        },

        {
          productId: 'nike-air-force',

          title: 'Kobe Air Force 1 Low',

          price: '18700',

          image: null,
        },
      ],

      () => 'result-nike',
    );

    expect(
      results.active?.products.map((product) => product.productId),
    ).toEqual(['nike-dunk', 'nike-mind', 'nike-air-force']);

    /**
     * =========================================================
     * 2. USER:
     *
     * "Хочу зелёные"
     *
     * REFINE текущего SearchSpec.
     * =========================================================
     */

    const greenNike = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          set: [
            {
              attributeId: 'color',

              operator: 'eq',

              value: 'зелёный',

              unit: null,
            },
          ],

          clear: [],
        },

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    state = greenNike.turn.state;

    expect(greenNike.turn.searchRequired).toBe(true);

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Nike');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'color',

          operator: 'eq',
        },
      )?.value,
    ).toBe('зелёный');

    expect(state.memory.memory.goals[0]?.text).toBe('повседневная носка');

    /**
     * =========================================================
     * SEARCH EXECUTION: GREEN NIKE
     *
     * Успешный search,
     * но products=[].
     *
     * Это НЕ technical failure.
     * =========================================================
     */

    const greenNikeExecution = beginSearchExecution(
      results,

      state.search!,

      () => 'execution-nike-green',
    );

    results = commitSearchExecution(
      greenNikeExecution.state,

      greenNikeExecution.executionId,

      [],

      () => 'result-nike-green',
    );

    expect(results.active?.products).toEqual([]);

    /**
     * =========================================================
     * 3. USER:
     *
     * "Тогда Adidas"
     *
     * Та же задача.
     *
     * Сохраняются:
     *
     * - MAN;
     * - зелёный;
     * - повседневная носка.
     *
     * Меняется только brand.
     * =========================================================
     */

    const greenAdidas = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          set: [
            {
              attributeId: 'brand',

              operator: 'eq',

              value: 'Adidas',

              unit: null,
            },
          ],

          clear: [],
        },

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    state = greenAdidas.turn.state;

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Adidas');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'gender',

          operator: 'eq',
        },
      )?.value,
    ).toBe('MAN');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'color',

          operator: 'eq',
        },
      )?.value,
    ).toBe('зелёный');

    expect(state.memory.memory.goals[0]?.text).toBe('повседневная носка');

    /**
     * =========================================================
     * SEARCH EXECUTION: GREEN ADIDAS
     * =========================================================
     */

    const greenAdidasExecution = beginSearchExecution(
      results,

      state.search!,

      () => 'execution-adidas-green',
    );

    results = commitSearchExecution(
      greenAdidasExecution.state,

      greenAdidasExecution.executionId,

      [],

      () => 'result-adidas-green',
    );

    expect(results.active?.products).toEqual([]);

    /**
     * =========================================================
     * 4. USER:
     *
     * "Цвет не важен"
     *
     * Semantic relaxation,
     * но deterministic operation:
     *
     * REFINE + clear color:eq.
     * =========================================================
     */

    const adidasWithoutColor = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          set: [],

          clear: [
            {
              attributeId: 'color',

              operator: 'eq',
            },
          ],
        },

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    state = adidasWithoutColor.turn.state;

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'color',

          operator: 'eq',
        },
      ),
    ).toBeNull();

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Adidas');

    /**
     * =========================================================
     * SEARCH EXECUTION: ADIDAS
     * =========================================================
     */

    const adidasExecution = beginSearchExecution(
      results,

      state.search!,

      () => 'execution-adidas',
    );

    results = commitSearchExecution(
      adidasExecution.state,

      adidasExecution.executionId,

      [
        {
          productId: 'adidas-handball',

          title: 'HANDBALL SPEZIAL SHOES',

          price: '12500',

          image: null,
        },

        {
          productId: 'adidas-campus',

          title: 'Campus 00s',

          price: '12800',

          image: null,
        },
      ],

      () => 'result-adidas',
    );

    expect(results.active?.resultId).toBe('result-adidas');

    expect(
      results.active?.products.map((product) => product.productId),
    ).toEqual(['adidas-handball', 'adidas-campus']);

    /**
     * =========================================================
     * 5. USER:
     *
     * "Сравни первый и второй"
     *
     * Новый search не нужен.
     *
     * Ordinal references разрешаются
     * относительно result-adidas.
     * =========================================================
     */

    const comparison = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'COMPARE',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: {
          kind: 'positions',

          positions: [
            1,

            2,
          ],
        },

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: 'result-adidas',
    });

    state = comparison.turn.state;

    expect(comparison.turn.searchRequired).toBe(false);

    expect(comparison.resolvedSelection?.productIds).toEqual([
      'adidas-handball',

      'adidas-campus',
    ]);

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Adidas');

    /**
     * =========================================================
     * 6. USER:
     *
     * "Первый слишком массивный,
     * что из остальных посоветуешь?"
     *
     * Один turn:
     *
     * FEEDBACK:
     * #1 → adidas-handball
     *
     * RECOMMEND:
     * #2 → adidas-campus
     * =========================================================
     */

    const recommendation = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'RECOMMEND',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: {
          kind: 'positions',

          positions: [2],
        },

        feedback: {
          selection: {
            kind: 'positions',

            positions: [1],
          },

          reaction: 'dislike',

          reason: 'слишком массивный',

          attributeId: null,

          sourceText: 'первый слишком массивный',
        },
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: 'result-adidas',
    });

    state = recommendation.turn.state;

    expect(recommendation.resolvedFeedbackSelection?.productIds).toEqual([
      'adidas-handball',
    ]);

    expect(recommendation.resolvedSelection?.productIds).toEqual([
      'adidas-campus',
    ]);

    expect(state.memory.memory.feedback).toEqual([
      {
        productId: 'adidas-handball',

        reaction: 'dislike',

        reason: 'слишком массивный',

        attributeId: null,

        sourceText: 'первый слишком массивный',
      },
    ]);

    /**
     * =========================================================
     * 7. USER:
     *
     * "А теперь найди женские платья"
     *
     * Новый независимый task.
     * =========================================================
     */

    const dressesSearch = prepareConsultationTurn({
      currentState: state,

      currentResults: results,

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: {
          semanticIntent: 'женские платья',

          category: 'CLOTHES',

          constraints: [
            {
              attributeId: 'gender',

              operator: 'eq',

              value: 'WOMAN',

              unit: null,
            },

            {
              attributeId: 'type',

              operator: 'eq',

              value: 'DRESS',

              unit: null,
            },
          ],
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: CLOTHES_PROFILE,

      expectedResultId: null,
    });

    state = dressesSearch.turn.state;

    expect(dressesSearch.turn.searchRequired).toBe(true);

    expect(state.search?.category).toBe('CLOTHES');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'gender',

          operator: 'eq',
        },
      )?.value,
    ).toBe('WOMAN');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'type',

          operator: 'eq',
        },
      )?.value,
    ).toBe('DRESS');

    /**
     * Old shoes brand
     * must not leak.
     */
    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      ),
    ).toBeNull();

    /**
     * Task-scoped memory
     * must not leak either.
     */
    expect(state.memory.memory.goals).toEqual([]);

    expect(state.memory.memory.criteria).toEqual([]);

    expect(state.memory.memory.feedback).toEqual([]);

    /**
     * =========================================================
     * 8. NEW TASK RESULTS NAMESPACE
     *
     * Application layer eventually owns
     * this reset atomically.
     *
     * Пока в Core-test явно создаём
     * новый results state.
     * =========================================================
     */

    results = createConsultationResultsState();

    /**
     * =========================================================
     * 9. TECHNICAL FAILURE
     *
     * Search был корректно начат,
     * но catalog infrastructure упал.
     *
     * Это принципиально отличается
     * от successful products=[].
     * =========================================================
     */

    const dressesExecution = beginSearchExecution(
      results,

      state.search!,

      () => 'execution-dresses',
    );

    results = failSearchExecution(
      dressesExecution.state,

      dressesExecution.executionId,
    );

    expect(results.pendingSearch).toBeNull();

    expect(results.active).toBeNull();

    expect(results.lastConfirmed).toBeNull();

    /**
     * SearchSpec задачи остаётся.
     *
     * Значит application layer
     * сможет сделать retry.
     */
    expect(state.search?.category).toBe('CLOTHES');

    expect(
      findSearchConstraint(
        state.search!,

        {
          attributeId: 'type',

          operator: 'eq',
        },
      )?.value,
    ).toBe('DRESS');
  });
});
