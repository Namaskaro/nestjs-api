import type { OrderRecord, OrderStatus } from './order-record.schema';

const ORDER_RELEVANCE_PRIORITY: Record<OrderStatus, number> = {
  SHIPPED: 70,

  PROCESSING: 60,

  PAID: 50,

  PENDING_PAYMENT: 40,

  DRAFT: 30,

  DELIVERED: 20,

  CANCELLED: 10,
};

export const CANCELLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PROCESSING',
];

export type OrderCancellationReason =
  | 'ALLOWED'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_SHIPPED'
  | 'ALREADY_DELIVERED'
  | 'REFUND_REQUIRED'
  | 'UNSUPPORTED_STATUS';

export interface OrderCancellationEligibility {
  allowed: boolean;

  reason: OrderCancellationReason;
}

export function selectRelevantOrder(
  orders: readonly OrderRecord[],
): OrderRecord | null {
  if (!orders.length) {
    return null;
  }

  return [...orders].sort((left, right) => {
    const priorityDifference =
      ORDER_RELEVANCE_PRIORITY[right.status] -
      ORDER_RELEVANCE_PRIORITY[left.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  })[0];
}

export function getOrderCancellationEligibility(
  order: OrderRecord,
): OrderCancellationEligibility {
  const hasSucceededPayment = order.payments.some(
    (payment) => payment.status === 'SUCCEEDED',
  );

  if (order.status === 'PAID' || hasSucceededPayment) {
    return {
      allowed: false,

      reason: 'REFUND_REQUIRED',
    };
  }

  if (order.status === 'CANCELLED') {
    return {
      allowed: false,

      reason: 'ALREADY_CANCELLED',
    };
  }

  if (order.status === 'SHIPPED') {
    return {
      allowed: false,

      reason: 'ALREADY_SHIPPED',
    };
  }

  if (order.status === 'DELIVERED') {
    return {
      allowed: false,

      reason: 'ALREADY_DELIVERED',
    };
  }

  if (CANCELLABLE_ORDER_STATUSES.includes(order.status)) {
    return {
      allowed: true,

      reason: 'ALLOWED',
    };
  }

  return {
    allowed: false,

    reason: 'UNSUPPORTED_STATUS',
  };
}
