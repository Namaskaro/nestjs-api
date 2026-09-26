import type { ProductDetails } from '../../core/consultation-core.schema';

/**
 * Application boundary для свежего
 * чтения актуальных ProductDetails.
 *
 * Product Consultation передаёт только
 * server-owned productIds.
 *
 * Конкретный магазин сам решает:
 *
 * - где читать товар;
 * - как проверять availability;
 * - как преобразовать его в ProductDetails.
 *
 * Отсутствующий в ответе productId
 * означает, что товар сейчас нельзя
 * использовать как актуального
 * consultation candidate.
 */
export interface ProductDetailsPort {
  getProductDetails(productIds: readonly string[]): Promise<ProductDetails[]>;
}

export const PRODUCT_DETAILS_PORT = Symbol('PRODUCT_DETAILS_PORT');
