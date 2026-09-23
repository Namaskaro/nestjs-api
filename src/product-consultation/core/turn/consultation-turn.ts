import type { ConsultationMemoryIdFactory } from '../memory/consultation-memory';

import {
  applyConsultationStateDelta,
  createEmptyProductConsultationState,
  replaceProductConsultationSearch,
} from '../state/consultation-state';

import type { ProductConsultationState } from '../state/consultation-state.schema';

import {
  ConsultationTurnInterpretationSchema,
  type ConsultationAction,
  type ProductSelection,
  type TurnFeedback,
} from './consultation-turn.schema';

const SEARCH_ACTIONS = new Set<ConsultationAction>([
  'SEARCH',
  'REFINE',
  'RELAX_CONSTRAINTS',
  'ALTERNATIVES',
]);

const ACTIONS_REQUIRING_EXISTING_SEARCH = new Set<ConsultationAction>([
  'REFINE',
  'RELAX_CONSTRAINTS',
  'ALTERNATIVES',
  'SHOW_RESULTS',
  'COMPARE',
  'DETAILS',
  'RECOMMEND',
  'FEEDBACK',
]);

export type AppliedConsultationTurn = {
  state: ProductConsultationState;

  action: ConsultationAction;

  searchRequired: boolean;

  selection: ProductSelection | null;

  feedback: TurnFeedback | null;
};

export function applyConsultationTurn(
  current: ProductConsultationState | null,

  rawInterpretation: unknown,

  createId?: ConsultationMemoryIdFactory,
): AppliedConsultationTurn {
  /**
   * Полная external validation
   * происходит ДО state mutation.
   */
  const interpretation =
    ConsultationTurnInterpretationSchema.parse(rawInterpretation);

  const baseState = current ?? createEmptyProductConsultationState();

  /**
   * SEARCH = новый полный SearchSpec.
   *
   * Если поиск уже существовал,
   * это новая независимая задача:
   * task memory сбрасывается.
   *
   * Если поиска ещё не было,
   * предварительно собранная через CLARIFY
   * memory сохраняется.
   */
  if (interpretation.action === 'SEARCH') {
    const hadExistingSearch = baseState.search !== null;

    let state = replaceProductConsultationSearch(
      baseState,

      interpretation.search!,

      {
        resetMemory: hadExistingSearch,
      },
    );

    if (interpretation.delta.memory !== undefined) {
      state = applyConsultationStateDelta(
        state,

        {
          memory: interpretation.delta.memory,
        },

        createId,
      );
    }

    return {
      state,

      action: interpretation.action,

      searchRequired: true,

      selection: null,

      feedback: null,
    };
  }

  /**
   * Нельзя REFINE / COMPARE / DETAILS...
   * то, чего ещё нет.
   *
   * CLARIFY / COMPLETE / HANDOFF
   * могут существовать до первого поиска.
   */
  if (
    baseState.search === null &&
    ACTIONS_REQUIRING_EXISTING_SEARCH.has(interpretation.action)
  ) {
    throw new Error(
      `ConsultationTurn: ${interpretation.action} requires an existing SearchSpec.`,
    );
  }

  const state = applyConsultationStateDelta(
    baseState,
    interpretation.delta,
    createId,
  );

  return {
    state,

    action: interpretation.action,

    searchRequired: SEARCH_ACTIONS.has(interpretation.action),

    selection: interpretation.selection,

    feedback: interpretation.feedback,
  };
}
