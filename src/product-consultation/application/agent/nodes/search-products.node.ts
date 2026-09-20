import type { GraphNode } from '@langchain/langgraph';
import { readProductContext } from '../../../../product-consultation/application/context/product-context.schema';
import { ProductAgentService } from '../product-agent.service';
import { ProductAgentState } from '../../../../product-consultation/application/agent/product-agent.state';
import { ProductNeedSchema } from '../../../../product-consultation/application/search/product-need.schema';

export function createSearchProductsNode(
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  return async (state) => {
    const context = readProductContext(state.productContext);

    const searchResults = await Promise.all(
      state.activeNeedIds.map(async (needId) => {
        const need = context.needs.find((item) => item.needId === needId);

        if (!need) {
          throw new Error('ProductAgent: active need отсутствует в context');
        }

        const productNeed = ProductNeedSchema.parse({
          semanticQuery: [
            need.semanticQuery,
            need.preferences.length
              ? 'Пожелания: ' + need.preferences.join('; ')
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
          filters: need.filters,
        });

        if (state.searchNeedIds.includes(needId)) {
          const result = await productAgentService.searchProducts(productNeed);

          return {
            needId,
            productNeed: result.productNeed,
            products: result.products.slice(0, 5),
          };
        }

        const selected = state.turn.products.filter(
          (ref) => ref.needId === needId,
        );

        const products = selected.length
          ? selected.map((ref) => {
              const product = need.shownProducts.find(
                (item) => item.id === ref.productId,
              );

              if (!product) {
                throw new Error(
                  'ProductAgent: resolved product отсутствует в context',
                );
              }

              return product;
            })
          : need.shownProducts;

        return { needId, productNeed, products };
      }),
    );

    return { searchResults };
  };
}
