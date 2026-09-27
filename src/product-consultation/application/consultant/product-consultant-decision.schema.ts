import { z } from 'zod';

import {
  ConsultationTurnProposalSchema,
  type ConsultationTurnProposal,
} from '../../core/turn/consultation-turn-proposal.schema';

import type { PublicConsultationAction } from '../../core/turn/consultation-turn.schema';

export const PRODUCT_CONSULTANT_CAPABILITY_ACTIONS = [
  'SEARCH',
  'REFINE',
  'SHOW_RESULTS',
  'COMPARE',
  'DETAILS',
  'RECOMMEND',
] as const satisfies readonly PublicConsultationAction[];

export const PRODUCT_CONSULTANT_TERMINAL_ACTIONS = [
  'COMPLETE',
  'CLARIFY',
  'HANDOFF',
  'FEEDBACK',
] as const satisfies readonly PublicConsultationAction[];

const CAPABILITY_ACTION_SET = new Set<string>(
  PRODUCT_CONSULTANT_CAPABILITY_ACTIONS,
);

const TERMINAL_ACTION_SET = new Set<string>(
  PRODUCT_CONSULTANT_TERMINAL_ACTIONS,
);

const UsageScenarioIdSchema = z.string().trim().min(1).max(160);

const UsageScenarioIdsSchema = z
  .array(UsageScenarioIdSchema)
  .max(3)
  .superRefine((scenarioIds, context) => {
    if (new Set(scenarioIds).size !== scenarioIds.length) {
      context.addIssue({
        code: 'custom',

        path: ['usageScenarioIds'],

        message:
          'Product Consultant decision contains duplicate usage scenario IDs.',
      });
    }
  });

const FactAttributeIdSchema = z.string().trim().min(1).max(160);

/**
 * Ephemeral fact focus.
 *
 * Это НЕ:
 *
 * - SearchSpec;
 * - Memory;
 * - hard constraint;
 * - persisted comparison criteria.
 *
 * Consultant только сообщает application:
 *
 * "для следующего reasoning round
 * особенно полезны эти ProductFacts".
 */
const FactAttributeIdsSchema = z
  .array(FactAttributeIdSchema)
  .max(16)
  .superRefine((attributeIds, context) => {
    if (new Set(attributeIds).size !== attributeIds.length) {
      context.addIssue({
        code: 'custom',

        path: ['factAttributeIds'],

        message:
          'Product Consultant decision contains duplicate fact attribute IDs.',
      });
    }
  });

export const ProductConsultantDecisionSchema = z
  .object({
    proposal: ConsultationTurnProposalSchema,

    /**
     * Ephemeral Usage Scenario selection.
     *
     * Scenario сам по себе
     * SearchSpec не изменяет.
     */
    usageScenarioIds: UsageScenarioIdsSchema.default(() => []),

    /**
     * S4:
     *
     * Ephemeral semantic focus
     * для verified ProductFacts.
     */
    factAttributeIds: FactAttributeIdsSchema.default(() => []),

    /**
     * null:
     *
     * backend capability ещё
     * должен выполниться.
     *
     * string:
     *
     * текущий turn заканчивается
     * пользовательским ответом.
     */
    terminalText: z.string().trim().min(1).max(6000).nullable(),
  })
  .strict()
  .superRefine((decision, context) => {
    const action = decision.proposal.action;

    const requiresCapability = CAPABILITY_ACTION_SET.has(action);

    const isTerminal = TERMINAL_ACTION_SET.has(action);

    if (!requiresCapability && !isTerminal) {
      context.addIssue({
        code: 'custom',

        path: ['proposal', 'action'],

        message: `Product Consultant action ${action} has no lifecycle classification.`,
      });

      return;
    }

    if (requiresCapability && decision.terminalText !== null) {
      context.addIssue({
        code: 'custom',

        path: ['terminalText'],

        message: `${action} requires backend capability execution before terminal response.`,
      });
    }

    if (isTerminal && decision.terminalText === null) {
      context.addIssue({
        code: 'custom',

        path: ['terminalText'],

        message: `${action} requires terminal text.`,
      });
    }
  });

export type ProductConsultantDecision = z.infer<
  typeof ProductConsultantDecisionSchema
>;

export function parseProductConsultantDecision(
  value: unknown,
): ProductConsultantDecision {
  return ProductConsultantDecisionSchema.parse(value);
}

export function productConsultantDecisionRequiresCapability(
  decisionRaw: ProductConsultantDecision,
): boolean {
  const decision = ProductConsultantDecisionSchema.parse(decisionRaw);

  return CAPABILITY_ACTION_SET.has(decision.proposal.action);
}

export function productConsultantDecisionIsTerminal(
  decisionRaw: ProductConsultantDecision,
): boolean {
  const decision = ProductConsultantDecisionSchema.parse(decisionRaw);

  return (
    TERMINAL_ACTION_SET.has(decision.proposal.action) &&
    decision.terminalText !== null
  );
}

export type ProductConsultantProposal = ConsultationTurnProposal;
