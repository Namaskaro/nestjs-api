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
    proposal: ConsultationTurnProposalSchema.describe(
      'Semantic turn proposal. This object never contains usageScenarioIds, factAttributeIds or terminalText.',
    ),

    usageScenarioIds: UsageScenarioIdsSchema.describe(
      'Root-level selected usage scenario IDs. Never place this field inside proposal.',
    ),

    factAttributeIds: FactAttributeIdsSchema.describe(
      'Root-level ephemeral ProductFact focus. Never place this field inside proposal.',
    ),

    terminalText: z
      .string()
      .trim()
      .min(1)
      .max(6000)
      .nullable()
      .default(null)
      .describe('Root-level terminal response. Null for capability actions.'),
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
  })
  .describe(
    'Product Consultant decision. proposal, usageScenarioIds, factAttributeIds and terminalText are four separate root-level fields.',
  );

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
