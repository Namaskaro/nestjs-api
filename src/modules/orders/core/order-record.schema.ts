import { z } from 'zod';

export const OrderStatusSchema = z.enum([
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]);

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderPaymentStatusSchema = z.enum([
  'PENDING',
  'SUCCEEDED',
  'FAILED',
]);

export type OrderPaymentStatus = z.infer<typeof OrderPaymentStatusSchema>;

export const OrderItemRecordSchema = z.object({
  productId: z.string(),

  title: z.string(),

  image: z.string().nullable(),

  quantity: z.number().int().positive(),

  size: z.string().nullable(),

  price: z.string(),
});

export type OrderItemRecord = z.infer<typeof OrderItemRecordSchema>;

export const OrderPaymentRecordSchema = z.object({
  id: z.union([z.string(), z.number().int()]),

  createdAt: z.date(),

  updatedAt: z.date(),

  orderId: z.string(),

  providerPaymentId: z.string(),

  amount: z.number(),

  status: OrderPaymentStatusSchema,

  paidAt: z.date().nullable(),

  rawResponse: z.unknown().nullable(),
});

export type OrderPaymentRecord = z.infer<typeof OrderPaymentRecordSchema>;

export const OrderRecordSchema = z.object({
  id: z.string(),

  createdAt: z.date(),

  updatedAt: z.date(),

  userId: z.string(),

  token: z.string().nullable(),

  cartId: z.string().nullable(),

  totalAmount: z.number(),

  finalAmount: z.number(),

  currency: z.string().nullable(),

  status: OrderStatusSchema,

  items: z.array(OrderItemRecordSchema),

  fullName: z.string().nullable(),

  address: z.string().nullable(),

  email: z.string().nullable(),

  phone: z.string().nullable(),

  comment: z.string().nullable(),

  deliveryDate: z.date().nullable(),

  deliveryFee: z.number().nullable(),

  deliveryTime: z.string().nullable(),

  deliveryProvider: z.string().nullable(),

  paymentType: z.string().nullable(),

  payments: z.array(OrderPaymentRecordSchema),
});

export type OrderRecord = z.infer<typeof OrderRecordSchema>;
