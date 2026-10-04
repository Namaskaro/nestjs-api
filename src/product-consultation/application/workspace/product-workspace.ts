import { z } from 'zod';
import {
  ConsultationApplicationRecordSchema,
  ConsultationRequestIdSchema,
  type ConsultationApplicationRecord,
} from '../runtime/consultation-application-record';

export const MAX_PRODUCT_TASKS = 5;
const TaskIdSchema = z.string().trim().min(1).max(160);

export const ProductWorkspaceSchema = z
  .object({
    version: z.literal(1),
    tasks: z
      .array(
        z
          .object({
            taskId: TaskIdSchema,
            query: z.string().trim().min(1).max(4000),
            record: ConsultationApplicationRecordSchema,
            question: z.string().trim().min(1).max(6000).nullable(),
          })
          .strict(),
      )
      .max(MAX_PRODUCT_TASKS),
    // References point into authoritative snapshots; no copied products/state.
    focus: z
      .array(
        z
          .object({
            taskId: TaskIdSchema,
            resultId: TaskIdSchema.nullable(),
            positions: z.array(z.number().int().min(1).max(25)).max(25),
          })
          .strict(),
      )
      .max(MAX_PRODUCT_TASKS),
    // Also covers creation/removal, which cannot be deduplicated by a child record.
    processedRequestIds: z.array(ConsultationRequestIdSchema).max(128),
    pendingClarification: z
      .object({
        query: z.string().trim().min(1).max(4000),
        question: z.string().trim().min(1).max(6000),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((workspace, context) => {
    const ids = workspace.tasks.map((task) => task.taskId);
    const focusIds = workspace.focus.map((focus) => focus.taskId);
    if (
      new Set(ids).size !== ids.length ||
      new Set(focusIds).size !== focusIds.length ||
      new Set(workspace.processedRequestIds).size !==
        workspace.processedRequestIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate workspace identity.',
      });
    }
    for (const focus of workspace.focus) {
      const task = workspace.tasks.find(
        (candidate) => candidate.taskId === focus.taskId,
      );
      const snapshot = task?.record.results.active;
      if (
        !task ||
        new Set(focus.positions).size !== focus.positions.length ||
        (focus.resultId === null
          ? focus.positions.length > 0
          : snapshot?.resultId !== focus.resultId ||
            focus.positions.some(
              (position) => position > snapshot.products.length,
            ))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Stale or invalid workspace reference.',
        });
      }
    }
  });

export type ProductWorkspace = z.infer<typeof ProductWorkspaceSchema>;
export type ProductTask = ProductWorkspace['tasks'][number];

export function createProductWorkspace(
  record?: ConsultationApplicationRecord | null,
): ProductWorkspace {
  return ProductWorkspaceSchema.parse({
    version: 1,
    tasks: record?.state
      ? [
          {
            taskId: 'migrated-single-task',
            query: record.state.search?.semanticIntent ?? 'Текущий подбор',
            record,
            question: null,
          },
        ]
      : [],
    focus: record?.state
      ? [
          {
            taskId: 'migrated-single-task',
            resultId: record.results.active?.resultId ?? null,
            positions:
              record.results.active?.products.map((_, index) => index + 1) ??
              [],
          },
        ]
      : [],
    processedRequestIds: record?.processedRequestIds ?? [],
  });
}

export function workspaceRecords(
  workspace?: ProductWorkspace | null,
  legacy?: ConsultationApplicationRecord | null,
) {
  return workspace
    ? workspace.tasks.map((task) => task.record)
    : legacy
    ? [legacy]
    : [];
}
