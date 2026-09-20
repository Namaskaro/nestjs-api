import { CATEGORY_PROFILES } from '@/src/product-consultation/core/profiles';
import type { ProductDetails } from '@/src/product-consultation/core/consultation-core.schema';
import { createCatalogAdapter } from '../catalog/catalog-adapter';
import {
  CURRENT_STORE_MAPPING,
  type StoreProductRow,
} from './current-store.mapping';

export { CURRENT_STORE_SOURCE_ID } from './current-store.mapping';

export type {
  ResolvedStoreCatalog,
  StoreCatalogEntity,
  StoreProductRow,
} from './current-store.mapping';

const currentStoreAdapter = createCatalogAdapter(
  CURRENT_STORE_MAPPING,
  CATEGORY_PROFILES,
);

export function toProductDetails(
  row: StoreProductRow,
  observedAt: string,
): ProductDetails {
  return currentStoreAdapter.mapOne(row, observedAt);
}

export function toProductDetailsMany(
  rows: readonly StoreProductRow[],
  observedAt: string,
): ProductDetails[] {
  return currentStoreAdapter.mapMany(rows, observedAt);
}
