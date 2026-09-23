import type { ConsultationMemoryIdFactory } from '../memory/consultation-memory';

import {
  applyConsultationStateDelta,
  createProductConsultationState,
} from '../state/consultation-state';

import type { ProductConsultationState } from '../state/consultation-state.schema';

import {
  ConsultationTurnInterpretationSchema,
  type ConsultationAction,
  type ConsultationTurnInterpretation,
  type ProductSelection,
} from './consultation-turn.schema';

const SEARCH_ACTIONS = new Set<ConsultationAction>([
  'SEARCH',
  'REFINE',
  'RELAX_CONSTRAINTS',
  'ALTERNATIVES',
]);

export type AppliedConsultationTurn = {
  state: ProductConsultationState;

  action: ConsultationAction;

  searchRequired: boolean;

  selection: ProductSelection | null;
};

export function applyConsultationTurn(
  current: ProductConsultationState | null,

  rawInterpretation: ConsultationTurnInterpretation,

  createId?: ConsultationMemoryIdFactory,
): AppliedConsultationTurn {
  const interpretation =
    ConsultationTurnInterpretationSchema.parse(rawInterpretation);

  if (current === null) {
    if (interpretation.action !== 'SEARCH') {
      throw new Error('ConsultationTurn: first turn must start with SEARCH.');
    }

    if (interpretation.initialSearch === null) {
      throw new Error('ConsultationTurn: first SEARCH requires initialSearch.');
    }

    if (interpretation.delta.search !== undefined) {
      throw new Error(
        'ConsultationTurn: first SEARCH cannot contain both initialSearch and search delta.',
      );
    }

    let state = createProductConsultationState(interpretation.initialSearch);

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
    };
  }

  if (interpretation.initialSearch !== null) {
    throw new Error(
      'ConsultationTurn: initialSearch is allowed only for the first turn.',
    );
  }

  const state = applyConsultationStateDelta(
    current,
    interpretation.delta,
    createId,
  );

  return {
    state,

    action: interpretation.action,

    searchRequired: SEARCH_ACTIONS.has(interpretation.action),

    selection: interpretation.selection,
  };
}
