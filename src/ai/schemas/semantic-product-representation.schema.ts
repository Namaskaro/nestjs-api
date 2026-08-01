import { z } from 'zod';

export const ProductSemanticRepresentationSchema = z.object({
  summary: z.string().min(1).max(400),

  targetAudience: z.array(z.string().min(1).max(120)).max(4),

  styleAssociations: z.array(z.string().min(1).max(80)).max(5),

  useCases: z.array(z.string().min(1).max(120)).max(5),

  pricePositioning: z.string().min(1).max(120),

  searchTags: z.array(z.string().min(1).max(100)).max(8),
});

export type ProductSemanticRepresentation = z.infer<
  typeof ProductSemanticRepresentationSchema
>;
