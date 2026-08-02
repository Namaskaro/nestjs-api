import z from 'zod';
import { ProductSearchResultSchema } from './product-search-results.schema';
import { ProductItemSchema } from './product-agent-result.schema';

export const ProductAnswerGroupSchema = z.object({
  /**
   * Нормализованный поисковый запрос,
   * к которому относятся найденные товары.
   */
  query: z.string(),

  /**
   * Текст перед конкретной группой товаров.
   *
   * Например:
   * «Вот что удалось найти среди мужских кроссовок».
   */
  message: z.string(),

  /**
   * Товары, найденные для этого запроса.
   *
   * Если ничего не найдено, возвращается пустой массив.
   */
  products: z.array(ProductItemSchema),
});

export const ProductAgentMessageSchema = z.object({
  message: z.string(),

  groups: z.array(
    z.object({
      query: z.string(),
      message: z.string(),
    }),
  ),
});

export const ProductAgentAnswerSchema = z.object({
  message: z.string(),
  groups: z.array(ProductAnswerGroupSchema),
});

export type ProductAgentAnswer = z.infer<typeof ProductAgentAnswerSchema>;
