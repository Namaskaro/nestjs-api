import {
  DEFAULT_CONSULTATION_AGENT_BUDGET,
  type AgentComparisonView,
  type ProductDetails,
} from '@/src/product-consultation/core/consultation-core.schema';

import { CATEGORY_PROFILES } from '@/src/product-consultation/core/profiles';

import { resolveCategoryUsageScenarioSelection } from '@/src/product-consultation/core/profiles/usage-scenarios';

import type { ProductDetailsPort } from '@/src/product-consultation/application/catalog/product-details.port';

import { compareConsultationProducts } from '@/src/product-consultation/application/comparison/deterministic-product-comparison';

import type { ConsultationApplicationRecord } from '@/src/product-consultation/application/runtime/consultation-application-record';

import type { ExecuteConsultationTurnResult } from '@/src/product-consultation/application/runtime/consultation-write-owner';

import type { ProductConsultantDecision } from '@/src/product-consultation/application/consultant/product-consultant-decision.schema';

import type { ProductConsultantRoundObservation } from '@/src/product-consultation/application/consultant/product-consultant-model.port';

export type ProductConsultantCapabilityResult = {
  observation: ProductConsultantRoundObservation;

  selectedProducts: ProductDetails[];

  comparison: AgentComparisonView | null;

  factAttributeIds: string[];

  usageScenarioIds: string[];
};

function orderedProducts(
  productIds: readonly string[],

  products: readonly ProductDetails[],
): ProductDetails[] {
  const byId = new Map(
    products.map((product) => [product.id, product] as const),
  );

  return productIds.flatMap((productId) => {
    const product = byId.get(productId);

    return product ? [product] : [];
  });
}

function selectedUsageScenarioIds(
  record: ConsultationApplicationRecord,

  decision: ProductConsultantDecision,
): string[] {
  const profileId = record.state?.search?.category ?? null;

  const selection = resolveCategoryUsageScenarioSelection(
    profileId,

    decision.usageScenarioIds,
  );

  return [...selection.selectedIds];
}

function prioritizedFactAttributeIds(input: {
  record: ConsultationApplicationRecord;

  decision: ProductConsultantDecision;

  usageScenarioIds: readonly string[];

  limit: number;
}): string[] {
  const profileId = input.record.state?.search?.category ?? null;

  if (profileId === null) {
    return [];
  }

  const profile =
    CATEGORY_PROFILES.find((candidate) => candidate.id === profileId) ?? null;

  if (profile === null) {
    return [];
  }

  const knownAttributes = new Set(
    profile.attributes.map((attribute) => attribute.id),
  );

  const ordered: string[] = [];

  const add = (attributeId: string) => {
    if (!knownAttributes.has(attributeId)) {
      return;
    }

    if (ordered.includes(attributeId)) {
      return;
    }

    ordered.push(attributeId);
  };

  for (const attributeId of input.decision.factAttributeIds) {
    add(attributeId);
  }

  const usage = resolveCategoryUsageScenarioSelection(
    profile.id,

    input.usageScenarioIds,
  );

  for (const scenario of usage.selected) {
    for (const attributeId of scenario.attributeIds) {
      add(attributeId);
    }
  }

  for (const attributeId of profile.defaultCriteria) {
    add(attributeId);
  }

  return ordered.slice(0, input.limit);
}

export async function executeProductConsultantCapability(input: {
  decision: ProductConsultantDecision;

  execution: ExecuteConsultationTurnResult;

  productDetails: Pick<ProductDetailsPort, 'getProductDetails'>;
}): Promise<ProductConsultantCapabilityResult> {
  const {
    decision,

    execution,

    productDetails,
  } = input;

  if (execution.status === 'duplicate' || execution.status === 'superseded') {
    throw new Error(
      `ProductConsultantCapability: unsupported execution status ${execution.status}.`,
    );
  }

  const record = execution.record;

  const usageScenarioIds = selectedUsageScenarioIds(
    record,

    decision,
  );

  const action = decision.proposal.action;

  switch (action) {
    case 'SEARCH':
    case 'REFINE': {
      if (execution.status === 'search_failed') {
        return {
          observation: {
            kind: 'search',

            status: 'failed',

            count: null,
          },

          selectedProducts: [],

          comparison: null,

          factAttributeIds: [],

          usageScenarioIds,
        };
      }

      if (execution.status === 'accepted') {
        return {
          observation: {
            kind: 'search',

            status: 'no_change',

            count: record.results.active?.products.length ?? null,
          },

          selectedProducts: [],

          comparison: null,

          factAttributeIds: [],

          usageScenarioIds,
        };
      }

      if (execution.status !== 'search_succeeded') {
        throw new Error(
          `ProductConsultantCapability: unexpected ${action} execution status.`,
        );
      }

      const snapshot = record.results.active;

      if (snapshot === null) {
        throw new Error(
          'ProductConsultantCapability: successful search has no active result.',
        );
      }

      const factAttributeIds = prioritizedFactAttributeIds({
        record,

        decision,

        usageScenarioIds,

        limit: DEFAULT_CONSULTATION_AGENT_BUDGET.initialFactAttributes,
      });

      const productIds = snapshot.products
        .slice(
          0,

          DEFAULT_CONSULTATION_AGENT_BUDGET.initialFactProducts,
        )
        .map((product) => product.productId);

      const fresh =
        productIds.length > 0
          ? await productDetails.getProductDetails(productIds)
          : [];

      return {
        observation: {
          kind: 'search',

          status: snapshot.products.length === 0 ? 'zero_results' : 'succeeded',

          count: snapshot.products.length,
        },

        selectedProducts: orderedProducts(
          productIds,

          fresh,
        ),

        comparison: null,

        factAttributeIds,

        usageScenarioIds,
      };
    }

    case 'SHOW_RESULTS': {
      if (execution.status !== 'accepted') {
        throw new Error(
          'ProductConsultantCapability: unexpected SHOW_RESULTS execution status.',
        );
      }

      const snapshot = record.results.active;

      return {
        observation: {
          kind: 'show_results',

          status: snapshot === null ? 'missing' : 'ready',

          count: snapshot?.products.length ?? 0,
        },

        selectedProducts: [],

        comparison: null,

        factAttributeIds: [],

        usageScenarioIds,
      };
    }

    case 'DETAILS': {
      if (execution.status !== 'accepted') {
        throw new Error(
          'ProductConsultantCapability: unexpected DETAILS execution status.',
        );
      }

      const selection = execution.resolvedSelection;

      if (selection === null || selection.productIds.length !== 1) {
        throw new Error(
          'ProductConsultantCapability: DETAILS selection is missing.',
        );
      }

      const factAttributeIds = prioritizedFactAttributeIds({
        record,

        decision,

        usageScenarioIds,

        limit: DEFAULT_CONSULTATION_AGENT_BUDGET.detailFactAttributes,
      });

      const fresh = await productDetails.getProductDetails(
        selection.productIds,
      );

      const products = orderedProducts(
        selection.productIds,

        fresh,
      );

      if (products.length !== selection.productIds.length) {
        return {
          observation: {
            kind: 'details',

            status: 'product_unavailable',
          },

          selectedProducts: [],

          comparison: null,

          factAttributeIds: [],

          usageScenarioIds,
        };
      }

      return {
        observation: {
          kind: 'details',

          status: 'ready',
        },

        selectedProducts: products,

        comparison: null,

        factAttributeIds,

        usageScenarioIds,
      };
    }

    case 'COMPARE': {
      if (execution.status !== 'accepted') {
        throw new Error(
          'ProductConsultantCapability: unexpected COMPARE execution status.',
        );
      }

      const selection = execution.resolvedSelection;

      if (selection === null || selection.productIds.length < 2) {
        throw new Error(
          'ProductConsultantCapability: COMPARE selection is missing.',
        );
      }

      const factAttributeIds = prioritizedFactAttributeIds({
        record,

        decision,

        usageScenarioIds,

        limit: DEFAULT_CONSULTATION_AGENT_BUDGET.detailFactAttributes,
      });

      const fresh = await productDetails.getProductDetails(
        selection.productIds,
      );

      const products = orderedProducts(
        selection.productIds,

        fresh,
      );

      if (products.length !== selection.productIds.length) {
        return {
          observation: {
            kind: 'compare',

            status: 'product_unavailable',
          },

          selectedProducts: [],

          comparison: null,

          factAttributeIds: [],

          usageScenarioIds,
        };
      }

      const state = record.state;

      if (state === null) {
        throw new Error(
          'ProductConsultantCapability: COMPARE requires consultation state.',
        );
      }

      const comparison = compareConsultationProducts({
        state,

        productIds: selection.productIds,

        products,

        attributeIds: null,
      });

      return {
        observation: {
          kind: 'compare',

          status: 'ready',
        },

        selectedProducts: products,

        comparison,

        factAttributeIds,

        usageScenarioIds,
      };
    }

    case 'RECOMMEND': {
      if (execution.status !== 'accepted') {
        throw new Error(
          'ProductConsultantCapability: unexpected RECOMMEND execution status.',
        );
      }

      const selection = execution.resolvedSelection;

      if (selection === null || selection.productIds.length < 1) {
        throw new Error(
          'ProductConsultantCapability: RECOMMEND selection is missing.',
        );
      }

      const factAttributeIds = prioritizedFactAttributeIds({
        record,

        decision,

        usageScenarioIds,

        limit: DEFAULT_CONSULTATION_AGENT_BUDGET.detailFactAttributes,
      });

      const fresh = await productDetails.getProductDetails(
        selection.productIds,
      );

      const products = orderedProducts(
        selection.productIds,

        fresh,
      );

      if (products.length !== selection.productIds.length) {
        return {
          observation: {
            kind: 'recommend',

            status: 'product_unavailable',
          },

          selectedProducts: [],

          comparison: null,

          factAttributeIds: [],

          usageScenarioIds,
        };
      }

      return {
        observation: {
          kind: 'recommend',

          status: 'context_ready',
        },

        selectedProducts: products,

        comparison: null,

        factAttributeIds,

        usageScenarioIds,
      };
    }

    default:
      throw new Error(
        `ProductConsultantCapability: action ${action} is not a capability action.`,
      );
  }
}
