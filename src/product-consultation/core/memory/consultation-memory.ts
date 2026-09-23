import { randomUUID } from 'node:crypto';

import {
  ConsultationMemorySchema,
  emptyConsultationMemory,
} from '../consultation-core.schema';

import {
  ConsultationMemoryCommandSchema,
  ConsultationMemoryStateSchema,
  type ConsultationMemoryCommand,
  type ConsultationMemoryState,
} from './consultation-memory-state.schema';

export type ConsultationMemoryIdFactory = () => string;

function assertDistinct(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`ConsultationMemory: duplicate ${label}`);
  }
}

function hasChanges(command: ConsultationMemoryCommand): boolean {
  return (
    command.patch.goals.add.length > 0 ||
    command.patch.goals.update.length > 0 ||
    command.patch.goals.remove.length > 0 ||
    command.patch.criteria.add.length > 0 ||
    command.patch.criteria.update.length > 0 ||
    command.patch.criteria.remove.length > 0 ||
    command.patch.feedback.upsert.length > 0 ||
    command.patch.feedback.remove.length > 0
  );
}

export function createConsultationMemoryState(): ConsultationMemoryState {
  return ConsultationMemoryStateSchema.parse({
    version: 1,

    revision: 0,

    memory: emptyConsultationMemory(),
  });
}

export function applyConsultationMemoryPatch(
  currentRaw: ConsultationMemoryState,

  commandRaw: ConsultationMemoryCommand,

  createId: ConsultationMemoryIdFactory = randomUUID,
): ConsultationMemoryState {
  const current = ConsultationMemoryStateSchema.parse(currentRaw);

  const command = ConsultationMemoryCommandSchema.parse(commandRaw);

  if (command.expectedRevision !== current.revision) {
    throw new Error(
      `ConsultationMemory: stale revision, expected=${command.expectedRevision}, actual=${current.revision}`,
    );
  }

  /**
   * Важный случай:
   *
   * turn изменил только SearchSpec.
   *
   * Например:
   * Nike → Adidas.
   *
   * Память вообще не должна
   * переписываться или получать
   * новую revision.
   */
  if (!hasChanges(command)) {
    return current;
  }

  const next = structuredClone(current.memory);

  /*
   * Goals
   */

  const goalUpdateIds = command.patch.goals.update.map((item) => item.goalId);

  const goalRemoveIds = command.patch.goals.remove.map((item) => item.goalId);

  assertDistinct(goalUpdateIds, 'goal update id');

  assertDistinct(goalRemoveIds, 'goal remove id');

  if (goalUpdateIds.some((id) => goalRemoveIds.includes(id))) {
    throw new Error(
      'ConsultationMemory: goal cannot be updated and removed in one patch',
    );
  }

  for (const item of command.patch.goals.update) {
    const index = next.goals.findIndex((goal) => goal.goalId === item.goalId);

    if (index < 0) {
      throw new Error(`ConsultationMemory: unknown goalId ${item.goalId}`);
    }

    next.goals[index] = {
      goalId: item.goalId,

      ...item.goal,
    };
  }

  for (const item of command.patch.goals.remove) {
    const index = next.goals.findIndex((goal) => goal.goalId === item.goalId);

    if (index < 0) {
      throw new Error(`ConsultationMemory: unknown goalId ${item.goalId}`);
    }

    next.goals.splice(index, 1);
  }

  for (const goal of command.patch.goals.add) {
    next.goals.push({
      goalId: createId(),

      ...goal,
    });
  }

  /*
   * Criteria
   */

  const criterionUpdateIds = command.patch.criteria.update.map(
    (item) => item.criterionId,
  );

  const criterionRemoveIds = command.patch.criteria.remove.map(
    (item) => item.criterionId,
  );

  assertDistinct(criterionUpdateIds, 'criterion update id');

  assertDistinct(criterionRemoveIds, 'criterion remove id');

  if (criterionUpdateIds.some((id) => criterionRemoveIds.includes(id))) {
    throw new Error(
      'ConsultationMemory: criterion cannot be updated and removed in one patch',
    );
  }

  for (const item of command.patch.criteria.update) {
    const index = next.criteria.findIndex(
      (criterion) => criterion.criterionId === item.criterionId,
    );

    if (index < 0) {
      throw new Error(
        `ConsultationMemory: unknown criterionId ${item.criterionId}`,
      );
    }

    next.criteria[index] = {
      criterionId: item.criterionId,

      ...item.criterion,
    };
  }

  for (const item of command.patch.criteria.remove) {
    const index = next.criteria.findIndex(
      (criterion) => criterion.criterionId === item.criterionId,
    );

    if (index < 0) {
      throw new Error(
        `ConsultationMemory: unknown criterionId ${item.criterionId}`,
      );
    }

    next.criteria.splice(index, 1);
  }

  for (const criterion of command.patch.criteria.add) {
    next.criteria.push({
      criterionId: createId(),

      ...criterion,
    });
  }

  /*
   * Product feedback
   */

  const feedbackUpsertIds = command.patch.feedback.upsert.map(
    (item) => item.productId,
  );

  const feedbackRemoveIds = command.patch.feedback.remove.map(
    (item) => item.productId,
  );

  assertDistinct(feedbackUpsertIds, 'feedback upsert product');

  assertDistinct(feedbackRemoveIds, 'feedback remove product');

  if (feedbackUpsertIds.some((id) => feedbackRemoveIds.includes(id))) {
    throw new Error(
      'ConsultationMemory: feedback cannot be upserted and removed in one patch',
    );
  }

  for (const removal of command.patch.feedback.remove) {
    const index = next.feedback.findIndex(
      (feedback) => feedback.productId === removal.productId,
    );

    if (index < 0) {
      throw new Error(
        `ConsultationMemory: unknown feedback product ${removal.productId}`,
      );
    }

    next.feedback.splice(index, 1);
  }

  for (const feedback of command.patch.feedback.upsert) {
    const index = next.feedback.findIndex(
      (item) => item.productId === feedback.productId,
    );

    if (index < 0) {
      next.feedback.push(feedback);
    } else {
      next.feedback[index] = feedback;
    }
  }

  return ConsultationMemoryStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    memory: ConsultationMemorySchema.parse(next),
  });
}
