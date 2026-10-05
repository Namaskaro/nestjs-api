import { jest } from '@jest/globals';
import type { AiService } from '@/src/ai/ai.service';
import { createProductAgent } from '../agent/product.agent';
import type { ProductAgentService } from '../agent/product-agent.service';
import { ProductConsultantDecisionSchema } from '../consultant/product-consultant-decision.schema';
import {
  ProductWorkspacePlanSchema,
  type ProductWorkspacePlan,
} from './product-workspace-plan';
import {
  createProductWorkspace,
  type ProductWorkspace,
} from './product-workspace';
import {
  CURRENT_STORE_SEARCH_CAPABILITIES,
  compileCurrentStoreSearchSpec,
} from '../../adapters/current-store/current-store-search-spec';
import type { SearchSpec } from '../../core/search/search-spec.schema';
import type { ProductDetails } from '../../core/consultation-core.schema';

export const constraint = (
  attributeId: string,
  value: string | number,
  operator = 'eq',
) => ({ attributeId, value, operator, unit: null });

export function action(
  name: string,
  extra: Record<string, unknown> = {},
  view: 'focus' | 'results' | 'comparison' | null = null,
) {
  return {
    view,
    decision: ProductConsultantDecisionSchema.parse({
      proposal: {
        action: name,
        taskTransition: name === 'SEARCH' ? 'start_new' : 'continue',
        ...extra,
      },
      usageScenarioIds: [],
      factAttributeIds: [],
      terminalText: ['COMPLETE', 'CLARIFY', 'HANDOFF', 'FEEDBACK'].includes(
        name,
      )
        ? 'Готово.'
        : null,
    }),
  };
}
export const positions = (...value: number[]) => ({
  selection: { kind: 'positions', positions: value },
});
export const lane = (
  query: string,
  actions: ReturnType<typeof action>[],
  target: unknown = { kind: 'current', view: 'results' },
) => ({ kind: 'consult', query, target, actions });
export const newSearch = (
  query: string,
  category = 'SHOES',
  constraints: unknown[] = [],
) =>
  lane(
    query,
    [
      action('SEARCH', {
        search: { semanticIntent: query, category, constraints },
      }),
    ],
    { kind: 'new' },
  );
export const plan = (...operations: unknown[]) =>
  ProductWorkspacePlanSchema.parse({ operations, clarification: null });
export const named = (
  workspace: ProductWorkspace,
  index: number,
  sourceText: string,
) => ({ kind: 'task', taskId: workspace.tasks[index].taskId, sourceText });

export const products = (spec: SearchSpec) =>
  [1, 2, 3].map((n) => ({
    productId: `${spec.semanticIntent}-${n}`,
    title: `${spec.semanticIntent} ${n}`,
    price: '1000',
    image: null,
  }));
export const details = (id: string): ProductDetails => ({
  id,
  title: id,
  description: 'Описание из каталога',
  productType: 'SHOES',
  profileId: 'SHOES',
  price: '1000',
  currency: 'RUB',
  discount: null,
  images: [],
  availability: { inStock: true, stock: 2 },
  brand: null,
  category: null,
  subcategory: null,
  attributes: [],
  source: {
    sourceId: 'fixture',
    recordId: id,
    observedAt: '2026-10-05T00:00:00.000Z',
    updatedAt: null,
  },
});

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function harness(initial = plan(newSearch('кроссовки'))) {
  let nextPlan = initial;
  const decide = jest.fn(async (_messages: unknown) => nextPlan);
  const respond = jest.fn(async (_messages: unknown) => ({
    text: 'Рекомендация по фактам каталога.',
  }));
  const model = {
    invoke: respond,
    withStructuredOutput: (_schema: unknown, options: { name: string }) => {
      const runnable = {
        invoke:
          options.name === 'product_workspace_decision'
            ? decide
            : jest.fn(async () => null),
        withRetry: () => runnable,
      };
      return runnable;
    },
  };
  const aiService = { getChatModel: () => model } as unknown as AiService;
  const service = {
    capabilities: () => CURRENT_STORE_SEARCH_CAPABILITIES,
    validate: (spec: SearchSpec) => {
      compileCurrentStoreSearchSpec(spec);
    },
    search: jest.fn(async (spec: SearchSpec) => products(spec)),
    getProductDetails: jest.fn(async (ids: readonly string[]) =>
      ids.map(details),
    ),
    getProductSemanticRepresentations: jest.fn(
      async (_ids: readonly string[]) => new Map(),
    ),
  };
  const agent = createProductAgent(
    aiService,
    service as unknown as ProductAgentService,
  );
  let serial = 0;
  return {
    agent,
    aiService,
    service,
    decide,
    respond,
    setPlan(value: ProductWorkspacePlan) {
      nextPlan = value;
    },
    run(
      query = 'кроссовки',
      workspace = createProductWorkspace(),
      requestId = `turn-${++serial}`,
    ) {
      return agent.invoke({
        query,
        sourceQuery: query,
        workspace,
        requestId,
        conversationId: 'multi-action-test',
        recentMessages: [],
      });
    },
  };
}
