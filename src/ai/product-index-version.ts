import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/generated';

export const PRODUCT_INDEX_SOURCE_INCLUDE = {
  brand: true,
  subcategory: { include: { category: true } },
} as const;

type Source = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INDEX_SOURCE_INCLUDE;
}>;

// Index identity follows searchable fields, not unrelated row writes (e.g. order stock decrements).
// Exact stock remains authoritative in PG; a change of eligibility still invalidates the index.
export function productIndexVersion(product: Source): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: product.id,
        title: product.title,
        description: product.description,
        brand: product.brand && {
          id: product.brand.id,
          name: product.brand.name,
        },
        subcategory: product.subcategory && {
          id: product.subcategory.id,
          name: product.subcategory.name,
          category: product.subcategory.category && {
            id: product.subcategory.category.id,
            name: product.subcategory.category.name,
          },
        },
        price: product.price,
        color: product.color,
        details: product.details,
        gender: product.gender,
        type: product.type,
        sizes: product.sizes,
        image: product.images[0] ?? '',
        eligible: product.inStock && product.stock > 0,
      }),
    )
    .digest('hex');
}
