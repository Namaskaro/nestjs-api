import { z } from 'zod';

export const OrderActionSchema = z.enum([
  'LIST',
  'GET',
  'LATEST',
  'RELEVANT',
  'CANCEL',
]);

export type OrderAction = z.infer<typeof OrderActionSchema>;

export const OrderRequestSchema = z.object({
  action: OrderActionSchema,

  orderId: z.string().trim().min(1).nullable(),
});

export type OrderRequest = z.infer<typeof OrderRequestSchema>;
