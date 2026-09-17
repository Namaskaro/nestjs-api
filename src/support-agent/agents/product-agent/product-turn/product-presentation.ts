import type {
  CategoryProfile,
  ProductDetails,
} from '../consultation-core/consultation-core.schema';

import {
  ProductDetailsPresentationSchema,
  ProductSnapshotSchema,
  type ProductDetailsPresentation,
  type ProductSnapshot,
} from '../schemas/product-presentation.schema';

const PRODUCT_ENVELOPE_ATTRIBUTE_IDS = new Set([
  'price',
  'brand',
  'category',
  'subcategory',
  'type',
  'inStock',
  'stock',
]);

export function buildProductSnapshot({
  product,
  profile,
  focusAttributeIds = [],
}: {
  product: ProductDetails;

  profile: CategoryProfile;

  focusAttributeIds?: readonly string[];
}): ProductSnapshot {
  const focus = new Set(focusAttributeIds);

  const factsByAttributeId = new Map(
    product.attributes.map((fact) => [fact.attributeId, fact] as const),
  );

  const attributes = profile.attributes.flatMap((definition) => {
    if (PRODUCT_ENVELOPE_ATTRIBUTE_IDS.has(definition.id)) {
      return [];
    }

    const fact = factsByAttributeId.get(definition.id);

    if (!fact) {
      return [];
    }

    if (fact.status !== 'known' && !focus.has(definition.id)) {
      return [];
    }

    return [
      {
        attributeId: definition.id,
        label: definition.label,
        kind: definition.kind,
        status: fact.status,
        value: fact.value,
        unit: fact.unit,
        displayValue: fact.displayValue,
      },
    ];
  });

  return ProductSnapshotSchema.parse({
    id: product.id,

    title: product.title,

    description: product.description,

    productType: product.productType,

    profileId: product.profileId,

    price: product.price,

    currency: product.currency,

    discount: product.discount,

    images: product.images,

    availability: product.availability,

    brand: product.brand,

    category: product.category,

    subcategory: product.subcategory,

    attributes,
  });
}

export function buildProductDetailsPresentation({
  needId,
  product,
  profile,
  focusAttributeIds = [],
}: {
  needId: string;

  product: ProductDetails;

  profile: CategoryProfile;

  focusAttributeIds?: readonly string[];
}): ProductDetailsPresentation {
  return ProductDetailsPresentationSchema.parse({
    needId,

    product: buildProductSnapshot({
      product,
      profile,
      focusAttributeIds,
    }),

    focusAttributeIds: [...new Set(focusAttributeIds)],
  });
}
