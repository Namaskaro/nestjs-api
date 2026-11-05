import { z } from 'zod';

export const OrderActionSchema = z.enum([
  'LIST',
  'GET',
  'LATEST',
  'RELEVANT',
  'STATUS',
  'TRACKING',
  'CANCEL',

  // Обращения, требующие проверки конкретного заказа.
  'RETURN_REQUEST',
  'EXCHANGE_REQUEST',
  'CLAIM_REQUEST',
]);

export type OrderAction = z.infer<typeof OrderActionSchema>;

export const OrderRequestSchema = z.object({
  action: OrderActionSchema,

  // Внутренний ID заказа.
  orderId: z.string().trim().min(1).nullable(),

  // Публичный номер заказа.
  orderNumber: z.string().trim().min(1).nullable().optional(),
});

export type OrderRequest = z.infer<typeof OrderRequestSchema>;
