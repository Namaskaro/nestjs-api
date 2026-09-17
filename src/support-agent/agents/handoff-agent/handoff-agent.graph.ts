// import { AiService } from '@/src/ai/ai.service';

// import { END, START, StateGraph } from '@langchain/langgraph';

// import { HandoffState } from './handoff-agent.state';

// import { createOperatorOfferNode } from './nodes/operator-offer.node';

// import { createPrepareHandoffNode } from './nodes/prepare-handoff.node';

// import { createHandoffNode } from './nodes/create-handoff.node';

// import { entryHandoffRoute } from './routes/entry-handoff.route';

// import { afterOperatorOfferRoute } from './routes/after-operator-offer.route';

// // START ИЗМЕНЕНИЙ — РАБОЧИЙ HANDOFF SUBGRAPH
// export function createHandoffAgentGraph(aiService: AiService) {
//   const operatorOfferNode = createOperatorOfferNode();

//   const prepareHandoffNode = createPrepareHandoffNode(aiService);

//   return new StateGraph(HandoffState)

//     .addNode('operatorOfferNode', operatorOfferNode)

//     .addNode('prepareHandoffNode', prepareHandoffNode)

//     .addNode('createHandoffNode', createHandoffNode)

//     .addConditionalEdges(START, entryHandoffRoute, {
//       operatorOfferNode: 'operatorOfferNode',

//       prepareHandoffNode: 'prepareHandoffNode',
//     })

//     .addConditionalEdges('operatorOfferNode', afterOperatorOfferRoute, {
//       prepareHandoffNode: 'prepareHandoffNode',

//       end: END,
//     })

//     .addEdge('prepareHandoffNode', 'createHandoffNode')

//     .addEdge('createHandoffNode', END)

//     .compile();
// }

// export type HandoffAgentGraph = ReturnType<typeof createHandoffAgentGraph>;
// // END ИЗМЕНЕНИЙ — РАБОЧИЙ HANDOFF SUBGRAPH

import { END, START, StateGraph } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { HandoffState } from './handoff-agent.state';
import { createHandoffNode } from './nodes/create-handoff.node';
import { createOperatorOfferNode } from './nodes/operator-offer.node';
import { createPrepareHandoffNode } from './nodes/prepare-handoff.node';
import { afterOperatorOfferRoute } from './routes/after-operator-offer.route';
import { entryHandoffRoute } from './routes/entry-handoff.route';

// ИЗМЕНЕНО: retry/timeout только на node с LLM-вызовом.
const PREPARE_HANDOFF_RETRY_POLICY = {
  maxAttempts: 2,
  initialInterval: 1_000,
};

export function createHandoffAgentGraph(aiService: AiService) {
  const operatorOfferNode = createOperatorOfferNode();

  const prepareHandoffNode = createPrepareHandoffNode(aiService);

  return new StateGraph(HandoffState)
    .addNode('operatorOfferNode', operatorOfferNode)

    .addNode('prepareHandoffNode', prepareHandoffNode, {
      retryPolicy: PREPARE_HANDOFF_RETRY_POLICY,
      timeout: 30_000,
    })

    .addNode('createHandoffNode', createHandoffNode)

    .addConditionalEdges(START, entryHandoffRoute, {
      operatorOfferNode: 'operatorOfferNode',

      prepareHandoffNode: 'prepareHandoffNode',
    })

    .addConditionalEdges('operatorOfferNode', afterOperatorOfferRoute, {
      prepareHandoffNode: 'prepareHandoffNode',

      end: END,
    })

    .addEdge('prepareHandoffNode', 'createHandoffNode')

    .addEdge('createHandoffNode', END)

    .compile();
}

export type HandoffAgentGraph = ReturnType<typeof createHandoffAgentGraph>;
