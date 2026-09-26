import type { ConsultationResultProduct } from '../../core/results/consultation-results.schema';

import type { SearchSpec } from '../../core/search/search-spec.schema';

/**
 * Application boundary продуктового поиска.
 *
 * Новый Product Consultation runtime
 * знает только SearchSpec.
 *
 * Он не должен знать:
 *
 * - ProductNeed;
 * - Qdrant;
 * - Prisma;
 * - store-specific catalog IDs;
 * - legacy search implementation.
 */
export interface ProductSearchPort {
  /**
   * Дешёвая deterministic preflight validation.
   *
   * Вызывается ДО изменения persistent
   * consultation state.
   *
   * Здесь adapter обязан проверить,
   * что каждый hard constraint
   * действительно исполним.
   *
   * Никакого network search
   * этот метод не запускает.
   */
  validate(search: SearchSpec): void;

  /**
   * Выполняет уже проверенный SearchSpec.
   */
  search(search: SearchSpec): Promise<ConsultationResultProduct[]>;
}

/**
 * Nest injection token.
 *
 * Конкретный Store adapter подключается
 * на composition root.
 */
export const PRODUCT_SEARCH_PORT = Symbol('PRODUCT_SEARCH_PORT');
