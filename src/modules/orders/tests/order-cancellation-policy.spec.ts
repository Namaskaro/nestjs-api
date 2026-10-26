import { describe, expect, it } from '@jest/globals';

import type {
  OrderRecord,
  OrderPaymentRecord,
  ShipmentRecord,
} from '../core/order-record.schema';

import {
  getOrderCancellationEligibility,
  getOrderCancellationPlan,
} from '../core/order-policy';

const DATE = new Date('2026-10-23T10:00:00.000Z');

function createOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-1',
    number: '10482',

    createdAt: DATE,
    updatedAt: DATE,

    userId: 'user-1',
    token: null,
    cartId: 'cart-1',

    totalAmount: 12000,
    finalAmount: 12000,
    currency: null,

    status: 'DRAFT',
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

    payments: [],
    shipments: [],

    ...overrides,
  };
}

function createPayment(
  status: OrderPaymentRecord['status'],
  amount = 12000,
): OrderPaymentRecord {
  return {
    id: 1,
    createdAt: DATE,
    updatedAt: DATE,
    orderId: 'order-1',
    providerPaymentId: 'payment-1',
    amount,
    status,
    paidAt: status === 'SUCCEEDED' ? DATE : null,
    rawResponse: null,
  };
}

function createShipment(
  overrides: Partial<ShipmentRecord> = {},
): ShipmentRecord {
  return {
    id: 'shipment-1',
    provider: 'SDEK',
    status: 'PENDING',

    trackingNumber: null,
    trackingUrl: null,
    estimatedDeliveryAt: null,
    shippedAt: null,
    deliveredAt: null,

    ...overrides,
  };
}

describe('Order cancellation business policy', () => {
  it('allows direct cancellation of DRAFT', () => {
    const order = createOrder();

    expect(getOrderCancellationPlan(order).route).toBe('DIRECT_CANCEL');

    expect(getOrderCancellationEligibility(order)).toEqual({
      allowed: true,
      reason: 'ALLOWED',
    });
  });

  it('allows unpaid PENDING_PAYMENT without active attempts', () => {
    const order = createOrder({
      status: 'PENDING_PAYMENT',
    });

    expect(getOrderCancellationPlan(order).route).toBe('DIRECT_CANCEL');
  });

  it('allows direct cancellation after failed payment attempts', () => {
    const order = createOrder({
      status: 'PENDING_PAYMENT',
      payments: [createPayment('FAILED')],
    });

    expect(getOrderCancellationPlan(order).route).toBe('DIRECT_CANCEL');
  });

  it('does not directly cancel DRAFT with a pending payment', () => {
    const order = createOrder({
      payments: [createPayment('PENDING')],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');

    expect(getOrderCancellationEligibility(order).allowed).toBe(false);
  });

  it('does not treat PENDING payment as failed payment', () => {
    const order = createOrder({
      status: 'PENDING_PAYMENT',
      payments: [createPayment('PENDING')],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('requires refund processing for PAID', () => {
    const order = createOrder({
      status: 'PAID',
      payments: [createPayment('SUCCEEDED')],
    });

    expect(getOrderCancellationPlan(order)).toEqual({
      route: 'REFUND_BEFORE_SHIPPING',
      hasSucceededPayment: true,
    });

    expect(getOrderCancellationEligibility(order).reason).toBe(
      'REFUND_REQUIRED',
    );
  });

  it('requires refund processing for paid PROCESSING order', () => {
    const order = createOrder({
      status: 'PROCESSING',
      payments: [createPayment('SUCCEEDED')],
    });

    expect(getOrderCancellationPlan(order).route).toBe(
      'REFUND_BEFORE_SHIPPING',
    );
  });

  it('does not automatically cancel PROCESSING without successful payment', () => {
    const order = createOrder({
      status: 'PROCESSING',
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');

    expect(getOrderCancellationEligibility(order).allowed).toBe(false);
  });

  it('detects inconsistent PAID without successful payment', () => {
    const order = createOrder({
      status: 'PAID',
    });

    expect(getOrderCancellationPlan(order)).toEqual({
      route: 'MANUAL_REVIEW',
      hasSucceededPayment: false,
    });
  });

  it('routes SHIPPED and IN_TRANSIT to delivery interception', () => {
    const order = createOrder({
      status: 'SHIPPED',
      payments: [createPayment('SUCCEEDED')],
      shipments: [
        createShipment({
          status: 'IN_TRANSIT',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('INTERCEPT_DELIVERY');

    expect(getOrderCancellationEligibility(order).reason).toBe(
      'ALREADY_SHIPPED',
    );
  });

  it('uses shipment status when Order.status is stale', () => {
    const order = createOrder({
      status: 'PROCESSING',
      shipments: [
        createShipment({
          status: 'IN_TRANSIT',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('INTERCEPT_DELIVERY');
  });

  it('routes delivered order to return workflow', () => {
    const order = createOrder({
      status: 'DELIVERED',
    });

    expect(getOrderCancellationPlan(order).route).toBe('RETURN_AFTER_DELIVERY');
  });

  it('detects all shipments delivered even with stale order status', () => {
    const order = createOrder({
      status: 'SHIPPED',
      shipments: [
        createShipment({
          id: 'shipment-1',
          status: 'DELIVERED',
        }),
        createShipment({
          id: 'shipment-2',
          status: 'DELIVERED',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('RETURN_AFTER_DELIVERY');
  });

  it('requires review after partial delivery', () => {
    const order = createOrder({
      status: 'SHIPPED',
      shipments: [
        createShipment({
          id: 'shipment-1',
          status: 'DELIVERED',
        }),
        createShipment({
          id: 'shipment-2',
          status: 'IN_TRANSIT',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('recognizes returned shipment', () => {
    const order = createOrder({
      status: 'SHIPPED',
      shipments: [
        createShipment({
          status: 'RETURNED',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('FINALIZE_RETURN');
  });

  it('requires review when only some shipments returned', () => {
    const order = createOrder({
      status: 'SHIPPED',
      shipments: [
        createShipment({
          id: 'shipment-1',
          status: 'RETURNED',
        }),
        createShipment({
          id: 'shipment-2',
          status: 'IN_TRANSIT',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('does not guess state of UNKNOWN shipment', () => {
    const order = createOrder({
      status: 'PROCESSING',
      shipments: [
        createShipment({
          status: 'UNKNOWN',
        }),
      ],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('does not assume unavailable shipment source means no shipments', () => {
    const order = createOrder({
      status: 'PROCESSING',
      shipments: null,
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('requires review when successful payment amount differs', () => {
    const order = createOrder({
      status: 'PAID',
      payments: [createPayment('SUCCEEDED', 5000)],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('requires review when there are multiple successful payments', () => {
    const first = createPayment('SUCCEEDED');

    const second: OrderPaymentRecord = {
      ...first,
      id: 2,
      providerPaymentId: 'payment-2',
    };

    const order = createOrder({
      status: 'PAID',
      payments: [first, second],
    });

    expect(getOrderCancellationPlan(order).route).toBe('MANUAL_REVIEW');
  });

  it('recognizes already cancelled order', () => {
    const order = createOrder({
      status: 'CANCELLED',
    });

    expect(getOrderCancellationPlan(order).route).toBe('ALREADY_CANCELLED');

    expect(getOrderCancellationEligibility(order)).toEqual({
      allowed: false,
      reason: 'ALREADY_CANCELLED',
    });
  });

  it('allows no direct cancellation after physical shipping began', () => {
    const order = createOrder({
      status: 'PROCESSING',
      shipments: [
        createShipment({
          status: 'IN_TRANSIT',
        }),
      ],
    });

    expect(getOrderCancellationEligibility(order).allowed).toBe(false);
  });
});
