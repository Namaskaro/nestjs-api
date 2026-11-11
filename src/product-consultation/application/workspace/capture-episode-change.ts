import type { ConsultationEpisodeChange } from '@/src/consultation-memory/consultation-memory.types';
import type { ProductWorkspace } from './product-workspace';
import type { ProductLaneOutcome } from './execute-product-lane';
import type { SearchSpec } from '../../core/search/search-spec.schema';

const retainedAttributes = new Set(['category', 'subcategory', 'brand', 'color', 'price', 'sizes']);
const key = (value: SearchSpec['constraints'][number]) => value.attributeId + ':' + value.operator;
type Task = ProductWorkspace['tasks'][number];

export function captureEpisodeChange(
  before: Task,
  result: ProductLaneOutcome,
  displayedProductIds: string[],
): ConsultationEpisodeChange | undefined {
  const accepted = result.actions.filter(({ result: value }) => !value.failed);
  if (!accepted.length || result.handoffRequested) return;
  const searched = accepted.some(({ decision }) => ['SEARCH', 'REFINE'].includes(decision.proposal.action));
  const starting = !before.memoryEpisodeId && !before.memorySourceMessageId && !before.record.results.lastConfirmed && searched;
  if (!starting && !before.memorySourceMessageId && !before.memoryEpisodeId) return;

  const change: ConsultationEpisodeChange = {
    taskKey: result.task.taskId,
    kind: starting ? 'start' : 'update',
    ...(before.memorySourceMessageId ? { previousSourceMessageId: before.memorySourceMessageId } : {}),
  };
  const beforeSearch = before.record.state?.search;
  const afterSearch = result.task.record.state?.search;
  if (searched && afterSearch && result.task.record.revision !== before.record.revision) {
    const previous = (beforeSearch?.constraints ?? []).filter(({ attributeId }) => retainedAttributes.has(attributeId));
    const next = afterSearch.constraints.filter(({ attributeId }) => retainedAttributes.has(attributeId));
    const oldByKey = new Map(previous.map((value) => [key(value), value]));
    const nextKeys = new Set(next.map(key));
    change.criteria = {
      ...(beforeSearch?.category !== afterSearch.category ? { profileId: afterSearch.category } : {}),
      set: next.filter((value) => JSON.stringify(value) !== JSON.stringify(oldByKey.get(key(value))))
        .map(({ attributeId, operator, value, unit }) => ({ attributeId, operator, value, unit })),
      clear: previous.filter((value) => !nextKeys.has(key(value))).map(({ attributeId, operator }) => ({ attributeId, operator })),
    };
    if (displayedProductIds.length) change.considered = displayedProductIds.slice(0, 20);
  }
  const comparison = result.task.lastComparison;
  const snapshot = result.task.record.results.active;
  if (comparison && snapshot?.resultId === comparison.resultId &&
      accepted.some(({ decision }) => decision.proposal.action === 'COMPARE')) {
    change.compared = comparison.positions.flatMap((position) =>
      snapshot.products[position - 1] ? [snapshot.products[position - 1].productId] : [],
    ).slice(0, 20);
  }
  const recommended = accepted.flatMap(({ result: value }) => value.recommendationProductIds ?? []);
  if (recommended.length) change.recommended = [...new Set(recommended)].slice(0, 5);
  if (result.closed && accepted.at(-1)?.decision.proposal.action === 'COMPLETE') {
    change.outcome = 'FINISHED_UNSPECIFIED';
  }
  return change.criteria || change.compared || change.recommended || change.outcome ? change : undefined;
}
