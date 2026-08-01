import { Send } from '@langchain/langgraph';
import { ProductAgentStateType } from '../product-agent.state';

export function dispatchProductSearchWorkers(state: ProductAgentStateType) {
  return state.normalizedQueries.map(
    (normalizedQuery) =>
      new Send('searchProduct', { searchQuery: normalizedQuery }),
  );
}
