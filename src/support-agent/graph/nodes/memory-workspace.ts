import { RemoveMessage, type BaseMessage } from '@langchain/core/messages';
import type { SupportAgentContext } from '../../context/support-agent-context.schema';
import {
  createProductWorkspace, ProductWorkspaceSchema, type ProductWorkspace,
} from '@/src/product-consultation/application/workspace/product-workspace';
import { createConsultationApplicationRecord } from '@/src/product-consultation/application/runtime/consultation-application-record';
import { createProductConsultationState } from '@/src/product-consultation/core/state/consultation-state';

type MemoryOrigin = { episodeId: string; revision?: number; sourceMessageId?: string };
const originsKey = 'consultationMemoryOrigins';
type Task = ProductWorkspace['tasks'][number];

function origin(task: Task): MemoryOrigin | null {
  return task.memoryEpisodeId ? {
    episodeId: task.memoryEpisodeId,
    revision: task.memoryEpisodeRevision,
    sourceMessageId: task.memorySourceMessageId,
  } : null;
}

function valid(value: MemoryOrigin, context?: Partial<SupportAgentContext>) {
  const expected = context?.memoryWitnesses?.[value.episodeId];
  return Boolean(expected && (value.revision === undefined
    ? value.sourceMessageId && value.sourceMessageId === expected.sourceMessageId
    : value.revision === expected.revision));
}

export function memoryAssistantMetadata(workspace: ProductWorkspace | null) {
  const origins = (workspace?.tasks ?? []).map(origin).filter(Boolean);
  return origins.length ? { [originsKey]: origins } : {};
}

function outdatedMessage(message: BaseMessage, context?: Partial<SupportAgentContext>) {
  const origins = message.additional_kwargs[originsKey];
  return Array.isArray(origins) && origins.some((item) =>
    typeof item?.episodeId !== 'string' || !valid(item as MemoryOrigin, context),
  );
}

export function filterMemoryContext(
  workspace: ProductWorkspace | null,
  messages: BaseMessage[],
  context?: Partial<SupportAgentContext>,
) {
  const tasks = workspace?.tasks.filter((task) => {
    const marker = origin(task);
    return !marker || valid(marker, context);
  });
  const removed = Boolean(workspace && tasks?.length !== workspace.tasks.length);
  const filtered = removed ? ProductWorkspaceSchema.parse({
    ...workspace, tasks,
    focus: workspace.focus.filter((entry) => tasks.some(({ taskId }) => taskId === entry.taskId)),
    pendingClarification: null,
  }) : workspace;
  if (filtered?.tasks.some((task) => Boolean(origin(task)))) context?.memoryUsed?.();
  const staleMessages = messages.filter((message) => outdatedMessage(message, context));
  if (messages.some((message) => !outdatedMessage(message, context) && Array.isArray(message.additional_kwargs[originsKey]))) {
    context?.memoryUsed?.();
  }
  return {
    workspace: filtered,
    messages: staleMessages.length ? messages.filter((message) => !staleMessages.includes(message)) : messages,
    removals: staleMessages.flatMap((message) => message.id ? [new RemoveMessage({ id: message.id })] : []),
  };
}

export function openMemoryWorkspace(
  workspace: ProductWorkspace | null,
  query: string,
  context?: Partial<SupportAgentContext>,
) {
  const continuation = context?.memoryContinuation;
  if (!continuation || !valid({ episodeId: continuation.episodeId, revision: continuation.revision }, context)) return workspace;
  const { snapshot, taskKey } = continuation;
  const current = workspace ?? createProductWorkspace();
  const record = createConsultationApplicationRecord();
  record.generation = 1;
  const knownProfiles: Record<string, string> = { SHOES: 'обувь', CLOTHES: 'одежда', ACCESSORIES: 'аксессуары' };
  const savedTerms = snapshot.constraints.filter(item =>
    item.operator === 'eq' && ['subcategory', 'brand', 'color'].includes(item.attributeId) && typeof item.value === 'string')
    .map(item => String(item.value));
  const savedIntent = [knownProfiles[snapshot.profileId ?? snapshot.goalKey ?? ''], ...savedTerms].filter(Boolean).join(' ');
  record.state = createProductConsultationState({
    semanticIntent: context.consultationAction === 'resume_unchanged'
      ? (savedIntent || 'подбор товаров').slice(0, 1000) : query.slice(0, 1000),
    category: snapshot.profileId,
    constraints: snapshot.constraints,
  });
  const task: Task = {
    taskId: taskKey,
    query: 'Продолженный подбор',
    record,
    question: null,
    memoryEpisodeId: continuation.episodeId,
    memoryEpisodeRevision: continuation.revision,
    memorySourceMessageId: snapshot.lastSourceMessageId ?? undefined,
  };
  context.memoryUsed?.();
  return ProductWorkspaceSchema.parse({
    ...current,
    tasks: [...current.tasks.filter((item) => item.taskId !== taskKey), task],
    focus: [{ taskId: taskKey, resultId: null, positions: [] }],
    pendingClarification: null,
  });
}
