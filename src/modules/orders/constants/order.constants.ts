import { DeliveryProvider, DiscountType } from '@/prisma/generated';

export const DELIVERY_PRICES: Partial<Record<DeliveryProvider, number>> = {
  [DeliveryProvider.POSTAL]: 450,
  [DeliveryProvider.EMS]: 600,
};

export const PROMOCODES = [
  {
    code: 'WELCOME5',
    discountType: DiscountType.PERCENT,
    discountValue: 5,
  },
  {
    code: 'SALE10',
    discountType: DiscountType.PERCENT,
    discountValue: 10,
  },
  {
    code: 'HERO15',
    discountType: DiscountType.PERCENT,
    discountValue: 15,
  },
];
