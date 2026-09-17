export const QDRANT_CLIENT = Symbol('QDRANT_CLIENT');

// ============================================================
// ИЗМЕНЕНО:
// Общие имена vectors.
// Qdrant ничего не знает про Product или AI provider.
// ============================================================

export const QDRANT_DENSE_VECTOR = 'dense';

export const QDRANT_SPARSE_VECTOR = 'bm25';

// ============================================================
// ОСТАВЛЕНО:
// Алиасы пока сохраняем, чтобы не ломать старые импорты
// Product Search.
// ============================================================

export const PRODUCTS_COLLECTION = 'products';

export const PRODUCT_DENSE_VECTOR = QDRANT_DENSE_VECTOR;

export const PRODUCT_SPARSE_VECTOR = QDRANT_SPARSE_VECTOR;
