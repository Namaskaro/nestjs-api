import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

import { AIMessage } from '@langchain/core/messages';

import {
  Command,
  END,
  type GraphNode,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import { SupportAgentState } from '@/src/support-agent/graph/support-agent.state';

import {
  ProductAgentFinalAnswerSchema,
  ProductSearchAnswerBlockSchema,
} from '@/src/support-agent/schemas/support-agent-answer.schema';

import { readProductContext } from '../../../product-consultation/application/context/product-context.schema';
import { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';

export function createProductAgentWorker(
  productAgent: ProductAgent,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    await dispatchCustomEvent(
      'assistant_status',
      {
        status: 'SEARCHING_PRODUCTS',
      },
      config,
    );

    const result = await productAgent.invoke({
      query: state.query,

      productContext: readProductContext(state.productContext),
    });

    const productContext = readProductContext(result.productContext);

    if (result.turn.action === 'HANDOFF') {
      const handoffRequest = result.turn.handoffRequest;

      if (!handoffRequest) {
        throw new Error(
          'ProductAgentWorker: HANDOFF не содержит handoffRequest',
        );
      }

      return new Command({
        goto: 'handoffAgent',

        update: {
          productContext,

          handoffRequest,

          workerResults: [],
        },
      });
    }

    if (!result.message) {
      throw new Error('ProductAgentWorker: ProductGraph не вернул message');
    }

    const groups = result.searchResults.map((searchResult) => ({
      query: searchResult.productNeed.semanticQuery,

      message:
        searchResult.products.length > 0
          ? 'Найденные товары.'
          : 'Товары не найдены.',

      products: searchResult.products,
    }));

    if (state.executionMode === 'multi') {
      const workerResult = ProductSearchAnswerBlockSchema.parse({
        worker: 'product_search',

        data: {
          message: result.message,

          groups,

          consultation: result.consultation,

          consultationCompletion: result.consultationCompletion,
        },
      });

      return new Command({
        goto: 'aggregateAnswer',

        update: {
          productContext,

          workerResults: [workerResult],
        },
      });
    }

    const answer = ProductAgentFinalAnswerSchema.parse({
      type: 'product_agent',

      message: result.message,

      groups,

      consultation: result.consultation,

      consultationCompletion: result.consultationCompletion,
    });

    return new Command({
      goto: END,

      update: {
        activeAgent: 'productAgent',

        productContext,

        answer,

        messages: [new AIMessage(answer.message)],
      },
    });
  };
}
