import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import type { ConsultationApplicationRecord } from '../../runtime/consultation-application-record';
import type { ProductConsultantDecision } from '../../consultant/product-consultant-decision.schema';
import type { ProductConsultationContextMessage } from '../../context/product-consultation-context';
import type { ProductAgentAnswer } from '../agreagte-answer.schema';
import {
  recoverZeroResults,
  type ZeroResultRecovery,
} from '../../search/zero-result-recovery';

export type ProductTaskExecutionInput = {
  query: string;
  conversationId: string;
  requestId: string;
  recentMessages: ProductConsultationContextMessage[];
  consultationRecord: ConsultationApplicationRecord;
  decision: ProductConsultantDecision;
};
export type ProductTaskExecutionResult = Pick<
  ProductAgentAnswer,
  'message' | 'consultation' | 'consultationCompletion'
> & {
  consultationRecord: ConsultationApplicationRecord;
  failed?: true;
  recommendationProductIds?: string[];
  recovery?: ZeroResultRecovery;
};

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { StateConsultationStore } from '@/src/product-consultation/application/agent/state-consultation-store';

import { ConsultationWriteOwner } from '@/src/product-consultation/application/runtime/consultation-write-owner';

import { executeProductConsultantCapability } from '@/src/product-consultation/application/consultant/product-consultant-capability';

import { buildProductConsultationContext } from '@/src/product-consultation/application/context/product-consultation-context';

import { createConsultationAgent } from '@/src/product-consultation/application/consultation-agent/consultation.agent';

import { finalizeComparisonPresentation } from '@/src/product-consultation/application/presentation/comparison-presentation';

import {
  buildComparisonConsultation,
  buildProductDetailsConsultation,
  prepareProductConsultantComparisonPresentation,
} from '@/src/product-consultation/application/presentation/product-consultant-presentation';

function searchMessage(
  action: 'SEARCH' | 'REFINE',
  status: 'failed' | 'no_change' | 'zero_results' | 'succeeded',
): string {
  if (status === 'failed') {
    return 'Не удалось выполнить поиск товаров.';
  }

  if (status === 'zero_results') {
    return 'По вашему запросу ничего не нашёл.';
  }

  if (status === 'no_change') {
    return 'Подборка не изменилась.';
  }

  return action === 'SEARCH'
    ? 'Нашёл подходящие варианты.'
    : 'Обновил подборку.';
}

export function createExecuteProductDecisionNode(
  aiService: AiService,

  productAgentService: ProductAgentService,
) {
  const consultant = createConsultationAgent(aiService);

  return async (
    state: ProductTaskExecutionInput,
    _config?: LangGraphRunnableConfig,
  ): Promise<ProductTaskExecutionResult> => {
    const decision = state.decision;

    if (decision === null) {
      throw new Error('ExecuteProductDecision: decision is missing.');
    }

    if (state.conversationId === null) {
      throw new Error('ExecuteProductDecision: conversationId is missing.');
    }

    if (state.requestId === null) {
      throw new Error('ExecuteProductDecision: requestId is missing.');
    }

    const store = new StateConsultationStore(state.consultationRecord);

    const writeOwner = new ConsultationWriteOwner(store, productAgentService);

    const expectedResultId =
      state.consultationRecord.results.active?.resultId ??
      state.consultationRecord.results.lastConfirmed?.resultId ??
      null;

    try {
      const execution = await writeOwner.execute({
        conversationId: state.conversationId,

        expectedRevision: state.consultationRecord.revision,

        requestId: state.requestId,

        proposal: decision.proposal,

        expectedResultId,
      });

      const record = execution.record;

      if (
        execution.status === 'duplicate' ||
        execution.status === 'superseded'
      ) {
        return {
          consultationRecord: record,
          consultation: null,
          consultationCompletion: null,
          message:
            execution.status === 'duplicate'
              ? 'Этот запрос уже обработан.'
              : 'Подборка уже обновлена другим запросом.',
        };
      }

      if (decision.terminalText !== null) {
        return {
          consultationRecord: record,

          consultation: null,

          consultationCompletion: null,

          message: decision.terminalText,
        };
      }

      const capability = await executeProductConsultantCapability({
        decision,

        execution,

        productDetails: productAgentService,
      });

      const action = decision.proposal.action;

      if (
        capability.observation.kind === 'recommend' &&
        capability.observation.status === 'product_unavailable'
      ) {
        return {
          consultationRecord: record,
          consultation: null,
          consultationCompletion: null,
          failed: true,
          message:
            'Не удалось рекомендовать выбранные товары: один из них сейчас недоступен.',
        };
      }

      if (action === 'SEARCH' || action === 'REFINE') {
        if (capability.observation.kind !== 'search') {
          throw new Error(
            `ExecuteProductDecision: invalid ${action} observation.`,
          );
        }

        const recovery =
          capability.observation.status === 'zero_results' &&
          record.state?.search &&
          record.results.active
            ? await recoverZeroResults({
                search: record.state.search,
                resultId: record.results.active.resultId,
                port: productAgentService,
              })
            : undefined;
        return {
          consultationRecord: record,
          consultation: null,
          consultationCompletion: null,
          ...(recovery ? { recovery } : {}),
          message:
            recovery?.question ??
            searchMessage(action, capability.observation.status),
          ...(capability.observation.status === 'failed'
            ? { failed: true as const }
            : {}),
        };
      }

      if (action === 'SHOW_RESULTS') {
        return {
          consultationRecord: record,

          consultation: null,

          consultationCompletion: null,

          message: 'Показываю текущую подборку.',
        };
      }

      if (action === 'DETAILS') {
        if (capability.observation.kind !== 'details') {
          throw new Error(
            'ExecuteProductDecision: invalid DETAILS observation.',
          );
        }

        if (capability.observation.status === 'product_unavailable') {
          return {
            failed: true,
            consultationRecord: record,

            consultation: null,

            consultationCompletion: null,

            message:
              'Выбранный товар сейчас недоступен для подробного просмотра.',
          };
        }

        const product = capability.selectedProducts[0];

        if (!product) {
          throw new Error(
            'ExecuteProductDecision: DETAILS product is missing.',
          );
        }

        const consultationState = record.state;

        if (consultationState === null) {
          throw new Error(
            'ExecuteProductDecision: DETAILS consultation state is missing.',
          );
        }

        const message = `Вот подробная информация о ${product.title}.`;

        return {
          consultationRecord: record,

          consultation: buildProductDetailsConsultation({
            state: consultationState,

            product,

            focusAttributeIds: decision.factAttributeIds,

            message,
          }),

          consultationCompletion: null,

          message,
        };
      }

      if (action === 'COMPARE') {
        if (capability.observation.kind !== 'compare') {
          throw new Error(
            'ExecuteProductDecision: invalid COMPARE observation.',
          );
        }

        if (capability.observation.status === 'product_unavailable') {
          return {
            failed: true,
            consultationRecord: record,

            consultation: null,

            consultationCompletion: null,

            message:
              'Не удалось сравнить выбранные товары: один из них сейчас недоступен.',
          };
        }

        if (capability.comparison === null) {
          throw new Error('ExecuteProductDecision: comparison is missing.');
        }

        const consultationState = record.state;

        if (consultationState === null) {
          throw new Error(
            'ExecuteProductDecision: COMPARE consultation state is missing.',
          );
        }

        const prepared = prepareProductConsultantComparisonPresentation({
          comparison: capability.comparison,

          products: capability.selectedProducts,

          state: consultationState,

          currentQuery: state.query,
        });

        const presentation = finalizeComparisonPresentation(prepared, null);

        const message = 'Сравнил выбранные товары.';

        return {
          consultationRecord: record,

          consultation: buildComparisonConsultation({
            state: consultationState,

            presentation,

            message,
          }),

          consultationCompletion: null,

          message,
        };
      }

      const recentMessages =
        decision.proposal.taskTransition === 'start_new'
          ? []
          : state.recentMessages;

      const semanticRepresentations =
        action === 'RECOMMEND' &&
        capability.observation.kind === 'recommend' &&
        capability.observation.status === 'context_ready' &&
        capability.selectedProducts.length > 0
          ? await productAgentService
              .getProductSemanticRepresentations(
                capability.selectedProducts.map((product) => product.id),
              )
              .catch(() => undefined)
          : undefined;

      const followup = buildProductConsultationContext({
        record,

        currentMessage: state.query,

        recentMessages,

        selectedProducts: capability.selectedProducts,

        factAttributeIds: capability.factAttributeIds,

        comparison: capability.comparison,

        usageScenarioIds: capability.usageScenarioIds,

        semanticRepresentations,
      });

      const response = await consultant.respond({
        context: followup.context,

        observation: capability.observation,
      });

      return {
        consultationRecord: record,

        consultation: null,

        consultationCompletion: null,

        message: response.terminalText,
        ...(action === 'RECOMMEND'
          ? {
              recommendationProductIds: capability.selectedProducts.map(
                (product) => product.id,
              ),
            }
          : {}),
      };
    } catch {
      // A capability/read/synthesis failure must not roll back an accepted task.
      return {
        consultationRecord: await store.load(state.conversationId),
        consultation: null,
        consultationCompletion: null,
        failed: true,
        message:
          'Не удалось завершить действие для этой подборки. Попробуйте ещё раз.',
      };
    }
  };
}
