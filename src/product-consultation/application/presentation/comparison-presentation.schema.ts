// import { z } from 'zod';

// const IdSchema = z.string().trim().min(1);

// const ComparisonFactStatusSchema = z.enum([
//   'known',
//   'unknown',
//   'not_applicable',
//   'conflicting',
// ]);

// const ComparisonFactValueSchema = z.union([
//   z.string(),
//   z.number(),
//   z.boolean(),
//   z.array(z.string()),
//   z.null(),
// ]);

// const ComparisonRowStateSchema = z.enum([
//   'same',
//   'different',
//   'numeric_difference',
//   'not_comparable',
//   'unknown',
// ]);

// const ComparisonNumericRangeSchema = z
//   .object({
//     min: z.number().finite(),
//     max: z.number().finite(),
//     spread: z.number().finite(),
//     unit: z.string().trim().min(1).nullable(),
//   })
//   .nullable();

// export const ComparisonPresentationProductSchema = z.object({
//   position: z.number().int().min(1).max(4),
//   productId: IdSchema,
//   title: z.string().trim().min(1),
//   image: z.string().trim().min(1).nullable(),
//   price: z.string().trim().min(1),
//   currency: z.string().trim().min(1).nullable(),
//   brand: z.string().trim().min(1).nullable(),
// });

// export const ComparisonPresentationRowSchema = z.object({
//   attributeId: IdSchema,
//   label: z.string().trim().min(1),
//   state: ComparisonRowStateSchema,
//   range: ComparisonNumericRangeSchema,

//   cells: z
//     .array(
//       z.object({
//         productId: IdSchema,
//         status: ComparisonFactStatusSchema,
//         value: ComparisonFactValueSchema,
//         unit: z.string().trim().min(1).nullable(),
//         displayValue: z.string().nullable(),
//       }),
//     )
//     .min(2)
//     .max(4),
// });

// export const ComparisonPresentationSchema = z.object({
//   comparisonId: IdSchema,
//   needId: IdSchema,
//   goal: z.string().trim().min(1).max(1000),
//   products: z.array(ComparisonPresentationProductSchema).min(2).max(4),
//   rows: z.array(ComparisonPresentationRowSchema).max(32),
//   keyDifferences: z.array(z.string().trim().min(1).max(500)).max(4),
//   recommendation: z.string().trim().min(1).max(1200),
//   recommendedProductId: IdSchema.nullable(),
//   note: z.string().trim().min(1).max(600).nullable(),
// });

// export const ComparisonSynthesisProductSchema = z.object({
//   position: z.number().int().min(1).max(4),
//   title: z.string().trim().min(1).max(300),
// });

// export const ComparisonSynthesisRowSchema = z.object({
//   attributeId: IdSchema,
//   label: z.string().trim().min(1).max(200),
//   state: ComparisonRowStateSchema,
//   range: ComparisonNumericRangeSchema,

//   cells: z
//     .array(
//       z.object({
//         position: z.number().int().min(1).max(4),
//         status: ComparisonFactStatusSchema,
//         value: ComparisonFactValueSchema,
//         unit: z.string().trim().min(1).nullable(),
//         displayValue: z.string().nullable(),
//       }),
//     )
//     .min(2)
//     .max(4),
// });

// export const ComparisonSynthesisGuidanceSchema = z.object({
//   when: z.string().trim().min(1).max(1000),
//   attributeIds: z.array(IdSchema).max(16),
//   instruction: z.string().trim().min(1).max(2000),
// });

// export const ComparisonSynthesisInputSchema = z.object({
//   goal: z.string().trim().min(1).max(1000),
//   currentQuery: z.string().trim().min(1).max(500),
//   preferences: z.array(z.string().trim().min(1).max(500)).max(10),
//   goals: z.array(z.string().trim().min(1).max(500)).max(8),
//   products: z.array(ComparisonSynthesisProductSchema).min(2).max(4),
//   rows: z.array(ComparisonSynthesisRowSchema).max(32),
//   keyDifferences: z.array(z.string().trim().min(1).max(500)).max(4),
//   guidance: z.array(ComparisonSynthesisGuidanceSchema).max(8),
// });

// export const ComparisonSynthesisOutputSchema = z.object({
//   recommendation: z.string().trim().min(1).max(1200),
//   preferredPosition: z.number().int().min(1).max(4).nullable(),
// });

// export type ComparisonPresentation = z.infer<
//   typeof ComparisonPresentationSchema
// >;

// export type ComparisonSynthesisInput = z.infer<
//   typeof ComparisonSynthesisInputSchema
// >;

// export type ComparisonSynthesisOutput = z.infer<
//   typeof ComparisonSynthesisOutputSchema
// >;

import { z } from 'zod';

import { ProductSnapshotSchema } from '@/src/product-consultation/application/presentation/product-presentation.schema';

const IdSchema = z.string().trim().min(1);

const ComparisonFactStatusSchema = z.enum([
  'known',
  'unknown',
  'not_applicable',
  'conflicting',
]);

const ComparisonFactValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const ComparisonRowStateSchema = z.enum([
  'same',
  'different',
  'numeric_difference',
  'not_comparable',
  'unknown',
]);

const ComparisonNumericRangeSchema = z
  .object({
    min: z.number().finite(),

    max: z.number().finite(),

    spread: z.number().finite(),

    unit: z.string().trim().min(1).nullable(),
  })
  .nullable();

export const ComparisonPresentationProductSchema = ProductSnapshotSchema.extend(
  {
    position: z.number().int().min(1).max(4),
  },
);

export const ComparisonPresentationRowSchema = z.object({
  attributeId: IdSchema,

  label: z.string().trim().min(1),

  state: ComparisonRowStateSchema,

  range: ComparisonNumericRangeSchema,

  cells: z
    .array(
      z.object({
        productId: IdSchema,

        status: ComparisonFactStatusSchema,

        value: ComparisonFactValueSchema,

        unit: z.string().trim().min(1).nullable(),

        displayValue: z.string().nullable(),
      }),
    )
    .min(2)
    .max(4),
});

export const ComparisonPresentationSchema = z.object({
  comparisonId: IdSchema,

  needId: IdSchema,

  goal: z.string().trim().min(1).max(1000),

  products: z.array(ComparisonPresentationProductSchema).min(2).max(4),

  rows: z.array(ComparisonPresentationRowSchema).max(32),

  keyDifferences: z.array(z.string().trim().min(1).max(500)).max(4),

  recommendation: z.string().trim().min(1).max(1200),

  recommendedProductId: IdSchema.nullable(),

  note: z.string().trim().min(1).max(600).nullable(),
});

export const ComparisonSynthesisProductSchema = z.object({
  position: z.number().int().min(1).max(4),

  title: z.string().trim().min(1).max(300),
});

export const ComparisonSynthesisRowSchema = z.object({
  attributeId: IdSchema,

  label: z.string().trim().min(1).max(200),

  state: ComparisonRowStateSchema,

  range: ComparisonNumericRangeSchema,

  cells: z
    .array(
      z.object({
        position: z.number().int().min(1).max(4),

        status: ComparisonFactStatusSchema,

        value: ComparisonFactValueSchema,

        unit: z.string().trim().min(1).nullable(),

        displayValue: z.string().nullable(),
      }),
    )
    .min(2)
    .max(4),
});

export const ComparisonSynthesisGuidanceSchema = z.object({
  when: z.string().trim().min(1).max(1000),

  attributeIds: z.array(IdSchema).max(16),

  instruction: z.string().trim().min(1).max(2000),
});

export const ComparisonSynthesisInputSchema = z.object({
  goal: z.string().trim().min(1).max(1000),

  currentQuery: z.string().trim().min(1).max(500),

  preferences: z.array(z.string().trim().min(1).max(500)).max(10),

  goals: z.array(z.string().trim().min(1).max(500)).max(8),

  products: z.array(ComparisonSynthesisProductSchema).min(2).max(4),

  rows: z.array(ComparisonSynthesisRowSchema).max(32),

  keyDifferences: z.array(z.string().trim().min(1).max(500)).max(4),

  guidance: z.array(ComparisonSynthesisGuidanceSchema).max(8),
});

export const ComparisonSynthesisOutputSchema = z.object({
  recommendation: z.string().trim().min(1).max(1200),

  preferredPosition: z.number().int().min(1).max(4).nullable(),
});

export type ComparisonPresentation = z.infer<
  typeof ComparisonPresentationSchema
>;

export type ComparisonSynthesisInput = z.infer<
  typeof ComparisonSynthesisInputSchema
>;

export type ComparisonSynthesisOutput = z.infer<
  typeof ComparisonSynthesisOutputSchema
>;
