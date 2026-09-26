import { z } from 'zod';

import {
  ConsultationTurnProposalSchema,
  type ConsultationTurnProposal,
} from '../../core/turn/consultation-turn-proposal.schema';

import type { PublicConsultationAction } from '../../core/turn/consultation-turn.schema';

/**
 * Actions, после которых application
 * обязан выполнить deterministic
 * capability/backend round.
 *
 * Поэтому текст пользователю
 * ещё не является terminal response.
 */
export const PRODUCT_CONSULTANT_CAPABILITY_ACTIONS = [
  'SEARCH',

  'REFINE',

  'SHOW_RESULTS',

  'COMPARE',

  'DETAILS',

  'RECOMMEND',
] as const satisfies readonly PublicConsultationAction[];

/**
 * Actions, после которых Consultant
 * уже может закончить текущий turn
 * обычным текстовым ответом.
 */
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
  .superRefine(
    (
      scenarioIds,

      context,
    ) => {
      if (new Set(scenarioIds).size !== scenarioIds.length) {
        context.addIssue({
          code: 'custom',

          path: ['usageScenarioIds'],

          message:
            'Product Consultant decision contains duplicate usage scenario IDs.',
        });
      }
    },
  );

/**
 * Один structured output
 * одного Product Consultant.
 *
 * Здесь намеренно НЕТ:
 *
 * - productId;
 * - resultId;
 * - executionId;
 * - revision;
 * - artifacts;
 * - tool call objects;
 * - internal Memory IDs;
 * - persistence commands.
 *
 * Все эти данные принадлежат backend.
 */
export const ProductConsultantDecisionSchema = z
  .object({
    /**
     * Semantic proposal,
     * который затем проходит
     * deterministic public boundary.
     */
    proposal: ConsultationTurnProposalSchema,

    /**
     * Usage Scenario selection
     * текущего reasoning round.
     *
     * Это ephemeral selection.
     *
     * Context Builder позже:
     *
     * - проверит profile;
     * - проверит известность ID;
     * - загрузит instruction.
     *
     * Scenario сам по себе
     * SearchSpec не изменяет.
     */
    usageScenarioIds: UsageScenarioIdsSchema.default(() => []),

    /**
     * Финальный обычный текст
     * пользователю.
     *
     * null означает:
     *
     * application сначала должна
     * выполнить proposal/capability
     * и снова вызвать ЭТОГО ЖЕ
     * Consultant с новым context.
     */
    terminalText: z.string().trim().min(1).max(6000).nullable(),
  })
  .strict()
  .superRefine(
    (
      decision,

      context,
    ) => {
      const action = decision.proposal.action;

      const requiresCapability = CAPABILITY_ACTION_SET.has(action);

      const isTerminal = TERMINAL_ACTION_SET.has(action);

      /**
       * Public action list должна
       * полностью принадлежать
       * одной из двух групп.
       *
       * Это защита от ситуации,
       * когда позже добавили action,
       * но забыли определить
       * его lifecycle semantics.
       */
      if (!requiresCapability && !isTerminal) {
        context.addIssue({
          code: 'custom',

          path: ['proposal', 'action'],

          message: `Product Consultant action ${action} has no lifecycle classification.`,
        });

        return;
      }

      /**
       * Нельзя генерировать
       * финальный ответ ДО того,
       * как backend реально
       * выполнил capability.
       *
       * Иначе модель может написать
       * результат поиска/сравнения,
       * которого ещё не существует.
       */
      if (requiresCapability && decision.terminalText !== null) {
        context.addIssue({
          code: 'custom',

          path: ['terminalText'],

          message: `${action} requires backend capability execution before terminal response.`,
        });
      }

      /**
       * Terminal semantic action
       * должен реально закончиться
       * текстом пользователю.
       */
      if (isTerminal && decision.terminalText === null) {
        context.addIssue({
          code: 'custom',

          path: ['terminalText'],

          message: `${action} requires terminal text.`,
        });
      }
    },
  );

export type ProductConsultantDecision = z.infer<
  typeof ProductConsultantDecisionSchema
>;

/**
 * Convenience для будущего loop.
 *
 * Функция сначала полностью
 * валидирует structured output.
 */
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

/**
 * Только compile-time удобство
 * для application loop.
 */
export type ProductConsultantProposal = ConsultationTurnProposal;
