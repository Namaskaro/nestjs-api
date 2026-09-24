import { z } from 'zod';

import { ConsultationMemoryPatchSchema } from '../consultation-core.schema';

import {
  ConsultationMemoryStateSchema,
  type ConsultationMemoryState,
} from './consultation-memory-state.schema';

import {
  ConsultationMemoryObservationsSchema,
  type ConsultationMemoryObservation,
} from './consultation-memory-observation.schema';

export type ConsultationMemoryPatch = z.infer<
  typeof ConsultationMemoryPatchSchema
>;

function emptyPatch(): ConsultationMemoryPatch {
  return {
    goals: {
      add: [],
      update: [],
      remove: [],
    },

    criteria: {
      add: [],
      update: [],
      remove: [],
    },

    feedback: {
      upsert: [],
      remove: [],
    },
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function compileGoalObservation(
  current: ConsultationMemoryState,

  observation: Extract<
    ConsultationMemoryObservation,
    {
      kind: 'goal';
    }
  >,

  patch: ConsultationMemoryPatch,
): void {
  const matches = current.memory.goals.filter(
    (goal) => normalizeText(goal.text) === normalizeText(observation.text),
  );

  if (matches.length > 1) {
    throw new Error(
      `ConsultationMemoryObservation: ambiguous goal "${observation.text}".`,
    );
  }

  const existing = matches[0] ?? null;

  if (observation.operation === 'forget') {
    /**
     * Forget неизвестной цели —
     * безопасный no-op.
     *
     * LLM не должна придумывать ID
     * и backend не обязан падать
     * из-за уже отсутствующей записи.
     */
    if (existing === null) {
      return;
    }

    patch.goals.remove.push({
      goalId: existing.goalId,

      sourceText: observation.sourceText,
    });

    return;
  }

  if (existing === null) {
    patch.goals.add.push({
      text: observation.text,

      importance: observation.importance,

      sourceText: observation.sourceText,
    });

    return;
  }

  /**
   * Повтор той же semantic информации
   * не должен увеличивать revision.
   */
  if (
    existing.importance === observation.importance &&
    normalizeText(existing.text) === normalizeText(observation.text)
  ) {
    return;
  }

  patch.goals.update.push({
    /**
     * ID найден backend-ом.
     *
     * Из observation он не пришёл.
     */
    goalId: existing.goalId,

    goal: {
      text: observation.text,

      importance: observation.importance,

      sourceText: observation.sourceText,
    },
  });
}

function criterionKey(attributeId: string, operator: string): string {
  return [attributeId, operator].join(':');
}

function compileCriterionObservation(
  current: ConsultationMemoryState,

  observation: Extract<
    ConsultationMemoryObservation,
    {
      kind: 'criterion';
    }
  >,

  patch: ConsultationMemoryPatch,
): void {
  const targetKey = criterionKey(observation.attributeId, observation.operator);

  const matches = current.memory.criteria.filter(
    (criterion) =>
      criterionKey(criterion.attributeId, criterion.operator) === targetKey,
  );

  if (matches.length > 1) {
    throw new Error(
      `ConsultationMemoryObservation: ambiguous criterion ${targetKey}.`,
    );
  }

  const existing = matches[0] ?? null;

  if (observation.operation === 'forget') {
    if (existing === null) {
      return;
    }

    patch.criteria.remove.push({
      criterionId: existing.criterionId,

      sourceText: observation.sourceText,
    });

    return;
  }

  const criterion = {
    attributeId: observation.attributeId,

    operator: observation.operator,

    value: observation.value,

    unit: observation.unit,

    /**
     * Это ключевой ownership invariant:
     *
     * hard requirements живут
     * только в SearchSpec.
     */
    required: false,

    importance: observation.importance,

    sourceText: observation.sourceText,
  };

  if (existing === null) {
    patch.criteria.add.push(criterion);

    return;
  }

  const semanticallyEqual =
    existing.attributeId === criterion.attributeId &&
    existing.operator === criterion.operator &&
    existing.value === criterion.value &&
    existing.unit === criterion.unit &&
    existing.required === false &&
    existing.importance === criterion.importance;

  if (semanticallyEqual) {
    return;
  }

  patch.criteria.update.push({
    /**
     * criterionId выбран backend-ом
     * по semantic key.
     */
    criterionId: existing.criterionId,

    criterion,
  });
}

/**
 * Превращает semantic observations
 * будущего Product Consultant
 * во внутренний CRUD patch.
 *
 * Consultant:
 *
 *   "remember price <= 15000"
 *
 * Backend:
 *
 *   находит criterionId либо понимает,
 *   что записи ещё нет;
 *
 *   затем создаёт add/update/remove.
 *
 * Внутренний CRUD остаётся implementation detail.
 */
export function compileConsultationMemoryObservations(
  currentRaw: ConsultationMemoryState,

  observationsRaw: unknown,
): ConsultationMemoryPatch {
  const current = ConsultationMemoryStateSchema.parse(currentRaw);

  const observations =
    ConsultationMemoryObservationsSchema.parse(observationsRaw);

  const patch = emptyPatch();

  for (const observation of observations) {
    if (observation.kind === 'goal') {
      compileGoalObservation(current, observation, patch);

      continue;
    }

    compileCriterionObservation(current, observation, patch);
  }

  return ConsultationMemoryPatchSchema.parse(patch);
}
