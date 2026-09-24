import type { CategoryProfile } from '../consultation-core.schema';

import { CategoryProfileSchema } from '../consultation-core.schema';

import {
  compileConsultationMemoryObservations,
  type ConsultationMemoryPatch,
} from '../memory/consultation-memory-observation';

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

import type {
  SearchConstraint,
  SearchSpec,
  SearchSpecDraft,
  SearchSpecPatch,
} from '../search/search-spec.schema';

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

function constraintKey(
  constraint: Pick<SearchConstraint, 'attributeId' | 'operator'>,
): string {
  return [constraint.attributeId, constraint.operator].join(':');
}

function normalizeSemanticText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticIntentContainsLiteralValue(
  semanticIntent: string,

  value: SearchConstraint['value'],
): boolean {
  /**
   * Пока проверяем только строковые
   * structured values.
   *
   * Это покрывает самый опасный
   * практический кейс:
   *
   * brand Nike → Adidas,
   * color green → blue и т.п.
   *
   * Числа и boolean здесь специально
   * не интерпретируем как natural language.
   */
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedValue = normalizeSemanticText(value);

  /**
   * Очень короткие значения вроде
   * M / L / XL или "43"
   * не используем для lexical check:
   * слишком велик риск ложных совпадений.
   */
  if (normalizedValue.length < 3) {
    return false;
  }

  return normalizeSemanticText(semanticIntent).includes(normalizedValue);
}

function assertSemanticIntentConsistencyAfterPatch(
  currentSearch: SearchSpec,

  candidate: SearchSpec,

  patch: SearchSpecPatch,
): void {
  /**
   * semanticIntent проверяем только если
   * structured constraints действительно
   * изменились.
   *
   * Empty REFINE или повтор brand=brand
   * здесь ничего не требуют.
   */
  const currentByKey = new Map<string, SearchConstraint>();

  const candidateByKey = new Map<string, SearchConstraint>();

  for (const constraint of currentSearch.constraints) {
    currentByKey.set(
      constraintKey(constraint),

      constraint,
    );
  }

  for (const constraint of candidate.constraints) {
    candidateByKey.set(
      constraintKey(constraint),

      constraint,
    );
  }

  for (const [key, previous] of currentByKey) {
    const next = candidateByKey.get(key);

    const removed = next === undefined;

    const changed =
      next !== undefined &&
      (next.value !== previous.value || next.unit !== previous.unit);

    if (!removed && !changed) {
      continue;
    }

    /**
     * Если старое structured value
     * вообще не было продублировано
     * в semanticIntent, проблемы нет.
     *
     * Например:
     *
     * semanticIntent = "мужские кроссовки"
     * brand = Nike
     *
     * Nike → Adidas
     *
     * semanticIntent можно оставить как есть.
     */
    if (
      !semanticIntentContainsLiteralValue(
        currentSearch.semanticIntent,
        previous.value,
      )
    ) {
      continue;
    }

    /**
     * Но если старое structured value
     * находилось в semanticIntent,
     * оно не должно пережить REFINE.
     */
    if (
      semanticIntentContainsLiteralValue(
        candidate.semanticIntent,
        previous.value,
      )
    ) {
      fail(
        `semanticIntent still contains stale structured value ` +
          `${String(previous.value)} after changing ${previous.attributeId}:${
            previous.operator
          }.`,
      );
    }
  }

  /**
   * patch используется здесь намеренно:
   * оставляем аргумент частью semantic
   * invariant API — дальше сюда можно
   * добавить проверки source of change,
   * не меняя сигнатуру вызывающего кода.
   */
  void patch;
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

    assertSemanticIntentConsistencyAfterPatch(
      currentState.search,
      candidate,
      patch,
    );

    return;
  }

  const profile = requireProfile(candidate.category, profileRaw);

  assertSearchSpecPatchMatchesCategoryProfile(patch, profile);

  assertSearchSpecMatchesCategoryProfile(candidate, profile);

  /**
   * Profile/type/unit/constraint validation
   * уже прошла.
   *
   * Теперь проверяем отсутствие
   * устаревшего literal structured value
   * внутри semanticIntent.
   */
  assertSemanticIntentConsistencyAfterPatch(
    currentState.search,
    candidate,
    patch,
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
