import { describe, expect, it } from '@jest/globals';

import type { OrderRecord, OrderStatus } from '../order-record.schema';

import {
  getOrderCancellationEligibility,
  selectRelevantOrder,
} from '../order-policy';

function createOrder(
  id: string,
  status: OrderStatus,
  createdAt: string,
  paymentSucceeded = false,
): OrderRecord {
  const date = new Date(createdAt);

  return {
    id,

    createdAt: date,

    updatedAt: date,

    userId: 'user-1',

    token: null,

    cartId: 'cart-1',

    totalAmount: 1000,

    finalAmount: 1000,

    currency: null,

    status,

    items: [],

    fullName: null,

    address: null,

    email: null,

    phone: null,

    comment: null,

    deliveryDate: null,

    deliveryFee: null,

    deliveryTime: null,

    deliveryProvider: null,

    paymentType: 'CARD',

    payments: paymentSucceeded
      ? [
          {
            id: 1,

            createdAt: date,

            updatedAt: date,

            orderId: id,

            providerPaymentId: 'payment-1',

            amount: 1000,

            status: 'SUCCEEDED',

            paidAt: date,

            rawResponse: null,
          },
        ]
      : [],
  };
}

describe('order policy', () => {
  it('prefers shipped order over newer draft', () => {
    const shipped = createOrder(
      'shipped',

      'SHIPPED',

      '2026-09-25T12:00:00.000Z',
    );

    const draft = createOrder(
      'draft',

      'DRAFT',

      '2026-09-27T12:00:00.000Z',
    );

    expect(selectRelevantOrder([draft, shipped])).toEqual(shipped);
  });

  it('prefers newest order inside same status priority', () => {
    const older = createOrder(
      'older',

      'PROCESSING',

      '2026-09-20T12:00:00.000Z',
    );

    const newer = createOrder(
      'newer',

      'PROCESSING',

      '2026-09-25T12:00:00.000Z',
    );

    expect(selectRelevantOrder([older, newer])).toEqual(newer);
  });

  it('allows cancellation of unpaid processing order', () => {
    const order = createOrder(
      'order-1',

      'PROCESSING',

      '2026-09-25T12:00:00.000Z',
    );

    expect(getOrderCancellationEligibility(order)).toEqual({
      allowed: true,

      reason: 'ALLOWED',
    });
  });

  it('requires refund when payment already succeeded', () => {
    const order = createOrder(
      'order-1',

      'PROCESSING',

      '2026-09-25T12:00:00.000Z',

      true,
    );

    expect(getOrderCancellationEligibility(order)).toEqual({
      allowed: false,

      reason: 'REFUND_REQUIRED',
    });
  });

  it('does not allow shipped order cancellation', () => {
    const order = createOrder(
      'order-1',

      'SHIPPED',

      '2026-09-25T12:00:00.000Z',
    );

    expect(getOrderCancellationEligibility(order).allowed).toBe(false);
  });
});
