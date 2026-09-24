import { describe, expect, it } from '@jest/globals';

import { createConsultationResultsState } from '../../results/consultation-results';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

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

function adidasSearch() {
  return {
    semanticIntent: 'мужские кроссовки Adidas',

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

        value: 'Adidas',

        unit: null,
      },
    ],
  };
}

describe('Consultation task boundary', () => {
  it('continue preserves pre-search memory when first search starts', () => {
    const clarified = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'ежедневная ходьба',

            importance: 'high',

            sourceText: 'я много хожу каждый день',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'goal-walking',
    });

    expect(clarified.turn.state.search).toBeNull();

    const searched = prepareConsultationTurn({
      currentState: clarified.turn.state,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'continue',

        search: nikeSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(searched.turn.state.memory.memory.goals).toEqual([
      {
        goalId: 'goal-walking',

        text: 'ежедневная ходьба',

        importance: 'high',

        sourceText: 'я много хожу каждый день',
      },
    ]);
  });

  it('start_new clears stale pre-search context before first search', () => {
    const oldClarification = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'обувь для тренировок',

            importance: 'high',

            sourceText: 'нужны для тренировок',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'old-goal',
    });

    /**
     * Пользователь передумал ДО первого поиска:
     *
     * "Нет, вообще ищу подарок брату —
     * покажи Nike."
     */
    const newTask = prepareConsultationTurn({
      currentState: oldClarification.turn.state,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: nikeSearch(),

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'подарок брату',

            importance: 'high',

            sourceText: 'ищу подарок брату',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'new-goal',
    });

    expect(newTask.turn.state.memory.memory.goals).toEqual([
      {
        goalId: 'new-goal',

        text: 'подарок брату',

        importance: 'high',

        sourceText: 'ищу подарок брату',
      },
    ]);

    expect(
      newTask.turn.state.memory.memory.goals.some(
        (goal) => goal.goalId === 'old-goal',
      ),
    ).toBe(false);
  });

  it('start_new CLARIFY clears old search and old memory immediately', () => {
    const firstTask = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'continue',

        search: nikeSearch(),

        searchPatch: null,

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

      createMemoryId: () => 'old-goal',
    });

    /**
     * Уже после Nike:
     *
     * "Теперь другое. Хочу Adidas
     * в подарок, но пока не знаю какие."
     *
     * Consultant решает сначала уточнить.
     */
    const newTaskClarification = prepareConsultationTurn({
      currentState: firstTask.turn.state,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'подарок',

            importance: 'high',

            sourceText: 'теперь ищу подарок',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'gift-goal',
    });

    /**
     * Старый Nike SearchSpec
     * больше не current.
     */
    expect(newTaskClarification.turn.state.search).toBeNull();

    /**
     * Старый daily-wear goal исчез.
     *
     * Новая информация сохранена.
     */
    expect(newTaskClarification.turn.state.memory.memory.goals).toEqual([
      {
        goalId: 'gift-goal',

        text: 'подарок',

        importance: 'high',

        sourceText: 'теперь ищу подарок',
      },
    ]);

    /**
     * После уточнения начинаем поиск
     * как CONTINUE той же новой задачи.
     */
    const searched = prepareConsultationTurn({
      currentState: newTaskClarification.turn.state,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'continue',

        search: adidasSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(searched.turn.state.memory.memory.goals[0]?.text).toBe('подарок');

    expect(
      searched.turn.state.search?.constraints.find(
        (constraint) => constraint.attributeId === 'brand',
      )?.value,
    ).toBe('Adidas');
  });

  it('start_new SEARCH clears previous task memory', () => {
    const first = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'continue',

        search: nikeSearch(),

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'повседневная носка',

            importance: 'normal',

            sourceText: 'на каждый день',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'daily-goal',
    });

    const second = prepareConsultationTurn({
      currentState: first.turn.state,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: adidasSearch(),

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(second.turn.state.memory.memory).toEqual({
      goals: [],
      criteria: [],
      feedback: [],
    });
  });

  it('rejects start_new together with selection from previous task', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: null,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'DETAILS',

          taskTransition: 'start_new',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: {
            kind: 'positions',

            positions: [1],
          },

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('start_new is not compatible with action DETAILS');
  });
});
