import { z } from 'zod';
import { tool } from 'langchain';
import { ConsultationCore } from '../../../consultation-core/consultation-core';
import {
  CompareProductsInputSchema,
  ConsultationMemoryPatchSchema,
  GetProductDetailsInputSchema,
} from '../../../consultation-core/consultation-core.schema';
import {
  UpdateConsultationMemoryToolInputSchema,
  type ConsultationMemoryOperation,
} from '../schemas/consultation-memory-tool.schema';

type MemoryPatch = z.infer<typeof ConsultationMemoryPatchSchema>;

function required<T>(value: T | null, field: string): T {
  if (value === null) {
    throw new Error('update_consultation_memory: требуется ' + field);
  }
  return value;
}

function buildMemoryPatch(
  operations: ConsultationMemoryOperation[],
): MemoryPatch {
  const patch: MemoryPatch = {
    goals: { add: [], update: [], remove: [] },
    criteria: { add: [], update: [], remove: [] },
    feedback: { upsert: [], remove: [] },
  };

  for (const operation of operations) {
    const sourceText = operation.sourceText;

    switch (operation.kind) {
      case 'goal_add':
      case 'goal_update': {
        const goal = {
          text: required(operation.text, 'text'),
          importance: required(operation.importance, 'importance'),
          sourceText,
        };

        if (operation.kind === 'goal_add') {
          patch.goals.add.push(goal);
        } else {
          patch.goals.update.push({
            goalId: required(operation.id, 'id'),
            goal,
          });
        }
        break;
      }

      case 'goal_remove':
        patch.goals.remove.push({
          goalId: required(operation.id, 'id'),
          sourceText,
        });
        break;

      case 'criterion_add':
      case 'criterion_update': {
        const criterion = {
          attributeId: required(operation.attributeId, 'attributeId'),
          operator: required(operation.operator, 'operator'),
          value: operation.value,
          unit: operation.unit,
          required: required(operation.required, 'required'),
          importance: required(operation.importance, 'importance'),
          sourceText,
        };

        if (operation.kind === 'criterion_add') {
          patch.criteria.add.push(criterion);
        } else {
          patch.criteria.update.push({
            criterionId: required(operation.id, 'id'),
            criterion,
          });
        }
        break;
      }

      case 'criterion_remove':
        patch.criteria.remove.push({
          criterionId: required(operation.id, 'id'),
          sourceText,
        });
        break;

      case 'feedback_upsert':
        patch.feedback.upsert.push({
          productId: required(operation.productId, 'productId'),
          reaction: required(operation.reaction, 'reaction'),
          reason: operation.reason,
          attributeId: operation.attributeId,
          sourceText,
        });
        break;

      case 'feedback_remove':
        patch.feedback.remove.push({
          productId: required(operation.productId, 'productId'),
          sourceText,
        });
        break;
    }
  }

  return ConsultationMemoryPatchSchema.parse(patch);
}

function toolResult(action: () => unknown): string {
  try {
    return JSON.stringify({ ok: true, result: action() });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Tool failed',
    });
  }
}

export function createConsultationCoreTools(
  core: ConsultationCore,
  sourceText: string,
) {
  const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ');

  const updateMemory = tool(
    async (input) =>
      toolResult(() => {
        if (
          input.operations.some(
            (operation) =>
              !normalize(sourceText).includes(normalize(operation.sourceText)),
          )
        ) {
          throw new Error(
            'sourceText должен быть цитатой текущего сообщения пользователя.',
          );
        }

        const result = core.updateMemory({
          needId: input.needId,
          expectedRevision: input.expectedRevision,
          patch: buildMemoryPatch(input.operations),
        });

        return {
          ...result,
          referenceOptions: core
            .referenceOptions(input.needId)
            .options.map(({ id, ...option }) => option),
        };
      }),
    {
      name: 'update_consultation_memory',
      description:
        'Адресно изменяет память по словам клиента. Возвращает актуальную revision, память и referenceOptions.',
      schema: UpdateConsultationMemoryToolInputSchema,
    },
  );

  const getProductDetails = tool(
    async (input) => toolResult(() => core.getProductDetails(input)),
    {
      name: 'get_product_details',
      description:
        'Проверенные факты разрешённых товаров из загруженного серверного snapshot.',
      schema: GetProductDetailsInputSchema,
    },
  );

  const compareProducts = tool(
    async (input) => toolResult(() => core.compareProducts(input)),
    {
      name: 'compare_products',
      description:
        'Детерминированное сравнение разрешённых товаров одной потребности.',
      schema: CompareProductsInputSchema,
    },
  );

  return { updateMemory, getProductDetails, compareProducts };
}
