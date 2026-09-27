import { isDeepStrictEqual } from 'node:util';

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

const LEGACY_SEARCH_ACTIONS = new Set<ConsultationAction>([
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

function applyMemoryOnly(
  state: ProductConsultationState,

  interpretation: ReturnType<typeof ConsultationTurnInterpretationSchema.parse>,

  createId?: ConsultationMemoryIdFactory,
): ProductConsultationState {
  if (interpretation.delta.memory === undefined) {
    return state;
  }

  return applyConsultationStateDelta(
    state,

    {
      memory: interpretation.delta.memory,
    },

    createId,
  );
}

export function applyConsultationTurn(
  current: ProductConsultationState | null,

  rawInterpretation: unknown,

  createId?: ConsultationMemoryIdFactory,
): AppliedConsultationTurn {
  const interpretation =
    ConsultationTurnInterpretationSchema.parse(rawInterpretation);

  const baseState = current ?? createEmptyProductConsultationState();

  /**
   * SEARCH:
   *
   * complete SearchSpec становится
   * authoritative и сразу требует
   * backend search execution.
   */
  if (interpretation.action === 'SEARCH') {
    let state = replaceProductConsultationSearch(
      baseState,

      interpretation.search!,

      {
        resetMemory: false,
      },
    );

    state = applyMemoryOnly(
      state,

      interpretation,

      createId,
    );

    return {
      state,

      action: interpretation.action,

      searchRequired: true,

      selection: null,

      feedback: null,
    };
  }

  /**
   * PRE-SEARCH CLARIFY:
   *
   * модель уже уверенно поняла
   * executable часть запроса,
   * но ей нужен ещё один ответ
   * пользователя перед поиском.
   *
   * Поэтому SearchSpec сохраняется,
   * однако searchRequired=false.
   *
   * Никакого DraftTask,
   * clarification state или
   * второго search object не создаём.
   */
  if (interpretation.action === 'CLARIFY' && interpretation.search !== null) {
    let state = replaceProductConsultationSearch(
      baseState,

      interpretation.search,

      {
        resetMemory: false,
      },
    );

    state = applyMemoryOnly(
      state,

      interpretation,

      createId,
    );

    return {
      state,

      action: interpretation.action,

      searchRequired: false,

      selection: null,

      feedback: null,
    };
  }

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

  let searchRequired = LEGACY_SEARCH_ACTIONS.has(interpretation.action);

  /**
   * REFINE запускает search
   * только если SearchSpec
   * действительно изменился.
   */
  if (interpretation.action === 'REFINE') {
    searchRequired = !isDeepStrictEqual(
      baseState.search,

      state.search,
    );
  }

  return {
    state,

    action: interpretation.action,

    searchRequired,

    selection: interpretation.selection,

    feedback: interpretation.feedback,
  };
}
