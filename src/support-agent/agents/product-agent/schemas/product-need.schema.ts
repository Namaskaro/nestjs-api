import { z } from 'zod';

export const ProductSearchFiltersSchema = z.object({
  gender: z
    .enum(['MAN', 'WOMAN', 'UNISEX'])
    .nullable()
    .describe(
      'Строгий пол: только если явно известен. Не угадывай и не используй UNISEX по умолчанию.',
    ),

  type: z
    .enum(['SHOES', 'CLOTHES', 'ACCESSORIES'])
    .nullable()
    .describe('Базовый тип товара, если его можно уверенно определить.'),

  brand: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      'Только уверенно распознанный бренд производителя. Неоднозначный термин оставь в semanticQuery и верни null.',
    ),

  category: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      'Широкая категория каталога. При известной конкретной subcategory обычно null.',
    ),

  subcategory: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      'Базовый класс товара без назначения, события или стиля: например кроссовки, костюм, платье.',
    ),

  color: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe('Явно указанный цвет; иначе null.'),

  size: z.string().nullable().describe('Явно известный размер; иначе null.'),

  minPrice: z
    .number()
    .nonnegative()
    .nullable()
    .describe('Явно заданная минимальная цена; иначе null.'),

  maxPrice: z
    .number()
    .nonnegative()
    .nullable()
    .describe('Явно заданная максимальная цена; иначе null.'),
});

export const ProductNeedSchema = z.object({
  semanticQuery: z
    .string()
    .min(1)
    .describe(
      'Смысловой поисковый запрос без выдуманных фактов. Сохраняй важные смысловые и неоднозначные термины пользователя.',
    ),

  filters: ProductSearchFiltersSchema,
});

export type ProductNeed = z.infer<typeof ProductNeedSchema>;
