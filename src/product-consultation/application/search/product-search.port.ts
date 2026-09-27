import type { ConsultationResultProduct } from '../../core/results/consultation-results.schema';

import type { SearchSpec } from '../../core/search/search-spec.schema';

import type { ProductSearchCapabilities } from './product-search-capabilities';

export interface ProductSearchPort {
  capabilities?(): ProductSearchCapabilities;

  validate(search: SearchSpec): void;

  search(search: SearchSpec): Promise<ConsultationResultProduct[]>;
}

export const PRODUCT_SEARCH_PORT = Symbol('PRODUCT_SEARCH_PORT');
