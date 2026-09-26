import type { CategoryProfile } from '../consultation-core.schema';

import { CategoryProfileSchema } from '../consultation-core.schema';

import {
  compileConsultationMemoryObservations,
  type ConsultationMemoryPatch,
} from '../memory/consultation-memory-observation';

import {
  assertCategoryProfileAttributeCondition,
  assertCategoryProfileAttributeSelector,
  requireCategoryProfileAttribute,
} from '../profiles/category-profile-attribute-validation';

import {
  createConsultationMemoryState,
  type ConsultationMemoryIdFactory,
} from '../memory/consultation-memory';

import {
  ConsultationResultsStateSchema,
  type ConsultationResultsState,
} from '../results/consultation-results.schema';

import {
  resolveProductSelectionForActionFromResult,
  type ResolvedProductSelection,
} from '../results/consultation-results';

import { applySearchSpecPatch } from '../search/search-spec';

import {
  assertSearchSpecMatchesCategoryProfile,
  assertSearchSpecPatchMatchesCategoryProfile,
} from '../search/search-spec-profile';

import { assertChangedStructuredLiteralsDoNotRemain } from '../search/search-semantic-intent';

import type { SearchSpec, SearchSpecDraft } from '../search/search-spec.schema';

import { createEmptyProductConsultationState } from '../state/consultation-state';

import {
  ProductConsultationStateSchema,
  type ProductConsultationState,
} from '../state/consultation-state.schema';

import {
  applyConsultationTurn,
  type AppliedConsultationTurn,
} from './consultation-turn';

import {
  ConsultationTurnInterpretationSchema,
  type ConsultationAction,
  type ConsultationTurnInterpretation,
  type ProductSelection,
} from './consultation-turn.schema';

import {
  ConsultationTurnProposalSchema,
  type ConsultationTurnProposal,
  type TurnFeedbackObservation,
} from './consultation-turn-proposal.schema';

export type PrepareConsultationTurnInput = {
  currentState: ProductConsultationState | null;

  currentResults: ConsultationResultsState;

  proposal: unknown;

  categoryProfile: CategoryProfile | null;

  expectedResultId: string | null;

  createMemoryId?: ConsultationMemoryIdFactory;
};

export type PreparedConsultationTurn = {
  turn: AppliedConsultationTurn;

  resolvedSelection: ResolvedProductSelection | null;

  resolvedFeedbackSelection: ResolvedProductSelection | null;
};

const ACTIONS_EXECUTING_CURRENT_SEARCH = new Set(['REFINE']);

function fail(message: string): never {
  throw new Error(`ConsultationTurnBoundary: ${message}`);
}

function hasMemoryPatchChanges(patch: ConsultationMemoryPatch): boolean {
  return (
    patch.goals.add.length > 0 ||
    patch.goals.update.length > 0 ||
    patch.goals.remove.length > 0 ||
    patch.criteria.add.length > 0 ||
    patch.criteria.update.length > 0 ||
    patch.criteria.remove.length > 0 ||
    patch.feedback.upsert.length > 0 ||
    patch.feedback.remove.length > 0
  );
}

function requireProfile(
  category: string | null,

  profileRaw: CategoryProfile | null,
): CategoryProfile {
  if (category === null) {
    fail('categorized SearchSpec is required for semantic profile validation.');
  }

  if (profileRaw === null) {
    fail(`CategoryProfile is required for category ${category}.`);
  }

  const profile = CategoryProfileSchema.parse(profileRaw);

  if (profile.id !== category) {
    fail(`CategoryProfile ${profile.id} does not match category ${category}.`);
  }

  return profile;
}

function semanticProfileForTask(
  baseState: ProductConsultationState | null,

  proposal: ConsultationTurnProposal,

  profileRaw: CategoryProfile | null,
): CategoryProfile | null {
  const category =
    proposal.action === 'SEARCH'
      ? proposal.search?.category ?? null
      : baseState?.search?.category ?? null;

  if (category === null) {
    return null;
  }

  return requireProfile(category, profileRaw);
}

function assertMemoryObservationSemantics(
  baseState: ProductConsultationState | null,

  proposal: ConsultationTurnProposal,

  profileRaw: CategoryProfile | null,
): void {
  const hasTypedCriterion = proposal.memoryObservations.some(
    (observation) => observation.kind === 'criterion',
  );

  const feedbackAttributeId = proposal.feedback?.attributeId ?? null;

  if (!hasTypedCriterion && feedbackAttributeId === null) {
    return;
  }

  const profile = semanticProfileForTask(baseState, proposal, profileRaw);

  if (profile === null) {
    fail(
      'typed Memory criterion or feedback attribute requires a categorized task.',
    );
  }

  for (const observation of proposal.memoryObservations) {
    if (observation.kind !== 'criterion') {
      continue;
    }

    if (observation.operation === 'remember') {
      assertCategoryProfileAttributeCondition(
        {
          attributeId: observation.attributeId,

          operator: observation.operator,

          value: observation.value,

          unit: observation.unit,
        },

        profile,
      );

      continue;
    }

    assertCategoryProfileAttributeSelector(
      {
        attributeId: observation.attributeId,

        operator: observation.operator,
      },

      profile,
    );
  }

  if (feedbackAttributeId !== null) {
    requireCategoryProfileAttribute(profile, feedbackAttributeId);
  }
}

function assertCompleteSearch(
  search: SearchSpec | SearchSpecDraft,

  profileRaw: CategoryProfile | null,
): void {
  if (search.category === null) {
    if (search.constraints.length > 0) {
      fail('SearchSpec with structured constraints requires a category.');
    }

    return;
  }

  const profile = requireProfile(search.category, profileRaw);

  assertSearchSpecMatchesCategoryProfile(search, profile);
}

function resolveTaskBaseState(
  currentState: ProductConsultationState | null,

  proposal: ConsultationTurnProposal,
): ProductConsultationState | null {
  if (proposal.taskTransition === 'start_new') {
    return createEmptyProductConsultationState();
  }

  return currentState;
}

function buildMemoryPatch(
  baseState: ProductConsultationState | null,

  proposal: ConsultationTurnProposal,
): ConsultationMemoryPatch {
  const memoryBase = baseState?.memory ?? createConsultationMemoryState();

  return compileConsultationMemoryObservations(
    memoryBase,

    proposal.memoryObservations,
  );
}

function internalSelection(
  proposal: ConsultationTurnProposal,
): ProductSelection | null {
  if (proposal.action === 'FEEDBACK') {
    return proposal.feedback?.selection ?? null;
  }

  return proposal.selection;
}

function internalFeedback(proposal: ConsultationTurnProposal) {
  if (proposal.action !== 'FEEDBACK' || proposal.feedback === null) {
    return null;
  }

  return {
    reaction: proposal.feedback.reaction,

    reason: proposal.feedback.reason,

    attributeId: proposal.feedback.attributeId,

    sourceText: proposal.feedback.sourceText,
  };
}

function buildInternalInterpretation(
  proposal: ConsultationTurnProposal,

  memoryPatch: ConsultationMemoryPatch,
): ConsultationTurnInterpretation {
  const delta: {
    search?: NonNullable<ConsultationTurnInterpretation['delta']['search']>;

    memory?: ConsultationMemoryPatch;
  } = {};

  if (proposal.searchPatch !== null) {
    delta.search = proposal.searchPatch;
  }

  if (hasMemoryPatchChanges(memoryPatch)) {
    delta.memory = memoryPatch;
  }

  return ConsultationTurnInterpretationSchema.parse({
    action: proposal.action,

    search: proposal.search,

    delta,

    selection: internalSelection(proposal),

    feedback: internalFeedback(proposal),
  });
}

function assertSearchSemantics(
  currentState: ProductConsultationState | null,

  interpretation: ConsultationTurnInterpretation,

  profileRaw: CategoryProfile | null,
): void {
  if (interpretation.action === 'SEARCH') {
    if (interpretation.search === null) {
      fail('SEARCH requires SearchSpec.');
    }

    /**
     * Здесь проверяем только authoritative
     * structured contract:
     *
     * category / attributes / operators /
     * values / units / numeric compatibility.
     *
     * semanticIntent может пока содержать
     * literal structured values.
     *
     * Residual semanticIntent —
     * целевое правило формирования proposal,
     * а не universally provable Core invariant.
     */
    assertCompleteSearch(interpretation.search, profileRaw);

    return;
  }

  if (!ACTIONS_EXECUTING_CURRENT_SEARCH.has(interpretation.action)) {
    return;
  }

  if (currentState === null || currentState.search === null) {
    fail(`${interpretation.action} requires an existing SearchSpec.`);
  }

  if (interpretation.delta.search === undefined) {
    assertCompleteSearch(currentState.search, profileRaw);

    return;
  }

  const patch = interpretation.delta.search;

  if (
    patch.category !== undefined &&
    currentState.search.category !== null &&
    patch.category !== currentState.search.category
  ) {
    fail(
      `cannot change category from ${currentState.search.category} ` +
        `to ${String(patch.category)} through ${
          interpretation.action
        }; use SEARCH.`,
    );
  }

  const candidate = applySearchSpecPatch(currentState.search, patch);

  if (candidate.category === null) {
    assertCompleteSearch(candidate, profileRaw);

    assertChangedStructuredLiteralsDoNotRemain(
      currentState.search,

      candidate,
    );

    return;
  }

  const profile = requireProfile(candidate.category, profileRaw);

  assertSearchSpecPatchMatchesCategoryProfile(patch, profile);

  assertSearchSpecMatchesCategoryProfile(candidate, profile);

  /**
   * Это единственный lexical semanticIntent
   * invariant, который Core может проверить
   * безопасно и детерминированно:
   *
   * если structured value было изменено
   * или удалено, его старая literal-копия
   * не должна пережить REFINE.
   *
   * Мы НЕ пытаемся здесь распознавать
   * произвольные новые facets
   * внутри natural language.
   */
  assertChangedStructuredLiteralsDoNotRemain(
    currentState.search,

    candidate,
  );
}

function resolveSelection(
  results: ConsultationResultsState,

  action: ConsultationAction,

  selection: ProductSelection | null,

  expectedResultId: string | null,
): ResolvedProductSelection | null {
  if (selection === null) {
    return null;
  }

  if (expectedResultId === null) {
    fail('product selection requires expectedResultId.');
  }

  return resolveProductSelectionForActionFromResult(
    results,

    action,

    expectedResultId,

    selection,
  );
}

function resolveFeedbackSelection(
  results: ConsultationResultsState,

  proposal: ConsultationTurnProposal,

  expectedResultId: string | null,

  resolvedMainSelection: ResolvedProductSelection | null,
): ResolvedProductSelection | null {
  if (proposal.feedback === null) {
    return null;
  }

  if (proposal.action === 'FEEDBACK') {
    return resolvedMainSelection;
  }

  return resolveSelection(
    results,

    'FEEDBACK',

    proposal.feedback.selection,

    expectedResultId,
  );
}

function appendResolvedFeedback(
  patch: ConsultationMemoryPatch,

  feedback: TurnFeedbackObservation | null,

  resolved: ResolvedProductSelection | null,
): void {
  if (feedback === null) {
    return;
  }

  if (resolved === null || resolved.productIds.length !== 1) {
    fail('semantic feedback must resolve to exactly one product.');
  }

  patch.feedback.upsert.push({
    productId: resolved.productIds[0]!,

    reaction: feedback.reaction,

    reason: feedback.reason,

    attributeId: feedback.attributeId,

    sourceText: feedback.sourceText,
  });
}

export function prepareConsultationTurn(
  input: PrepareConsultationTurnInput,
): PreparedConsultationTurn {
  const currentState =
    input.currentState === null
      ? null
      : ProductConsultationStateSchema.parse(input.currentState);

  const currentResults = ConsultationResultsStateSchema.parse(
    input.currentResults,
  );

  const proposal = ConsultationTurnProposalSchema.parse(input.proposal);

  const taskBaseState = resolveTaskBaseState(currentState, proposal);

  assertMemoryObservationSemantics(
    taskBaseState,

    proposal,

    input.categoryProfile,
  );

  const memoryPatch = buildMemoryPatch(taskBaseState, proposal);

  const preliminaryInterpretation = buildInternalInterpretation(
    proposal,

    memoryPatch,
  );

  assertSearchSemantics(
    taskBaseState,

    preliminaryInterpretation,

    input.categoryProfile,
  );

  const resolvedSelection = resolveSelection(
    currentResults,

    preliminaryInterpretation.action,

    preliminaryInterpretation.selection,

    input.expectedResultId,
  );

  const resolvedFeedbackSelection = resolveFeedbackSelection(
    currentResults,

    proposal,

    input.expectedResultId,

    resolvedSelection,
  );

  appendResolvedFeedback(
    memoryPatch,

    proposal.feedback,

    resolvedFeedbackSelection,
  );

  const finalInterpretation = buildInternalInterpretation(
    proposal,

    memoryPatch,
  );

  const turn = applyConsultationTurn(
    taskBaseState,

    finalInterpretation,

    input.createMemoryId,
  );

  return {
    turn,

    resolvedSelection,

    resolvedFeedbackSelection,
  };
}
