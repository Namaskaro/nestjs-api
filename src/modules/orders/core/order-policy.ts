import type {
  OrderRecord,
  OrderStatus,
  ShipmentStatus,
} from './order-record.schema';

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
];

const STARTED_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'EXCEPTION',
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

export type OrderCancellationRoute =
  | 'DIRECT_CANCEL'
  | 'REFUND_BEFORE_SHIPPING'
  | 'INTERCEPT_DELIVERY'
  | 'FINALIZE_RETURN'
  | 'RETURN_AFTER_DELIVERY'
  | 'ALREADY_CANCELLED'
  | 'MANUAL_REVIEW';

export interface OrderCancellationPlan {
  route: OrderCancellationRoute;
  hasSucceededPayment: boolean;
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

export function getOrderCancellationPlan(
  order: OrderRecord,
): OrderCancellationPlan {
  const successfulPayments = order.payments.filter(
    (payment) => payment.status === 'SUCCEEDED',
  );

  const hasSucceededPayment = successfulPayments.length > 0;

  const plan = (route: OrderCancellationRoute): OrderCancellationPlan => ({
    route,
    hasSucceededPayment,
  });

  // Заказ уже отменён.
  if (order.status === 'CANCELLED') {
    return plan('ALREADY_CANCELLED');
  }

  // Доставленный заказ обрабатывается
  // в рамках процедуры возврата товара.
  if (order.status === 'DELIVERED') {
    return plan('RETURN_AFTER_DELIVERY');
  }

  // Если состояние отправлений не получено,
  // нельзя предполагать, что их нет.
  if (order.shipments == null) {
    return plan(
      order.status === 'SHIPPED' ? 'INTERCEPT_DELIVERY' : 'MANUAL_REVIEW',
    );
  }

  const shipments = order.shipments;

  const deliveredCount = shipments.filter(
    (shipment) => shipment.status === 'DELIVERED',
  ).length;

  // Если доставлены все отправления,
  // это обычный возврат после доставки.
  if (shipments.length > 0 && deliveredCount === shipments.length) {
    return plan('RETURN_AFTER_DELIVERY');
  }

  // Частичная доставка требует отдельной
  // обработки. Мы не отменяем автоматически
  // уже полученную покупателем часть.
  if (deliveredCount > 0) {
    return plan('MANUAL_REVIEW');
  }

  const returnedCount = shipments.filter(
    (shipment) => shipment.status === 'RETURNED',
  ).length;

  // Все отправления вернулись отправителю.
  if (shipments.length > 0 && returnedCount === shipments.length) {
    return plan('FINALIZE_RETURN');
  }

  // Часть посылок вернулась, а часть
  // находится в другом состоянии.
  if (returnedCount > 0) {
    return plan('MANUAL_REVIEW');
  }

  const hasUnknownShipment = shipments.some(
    (shipment) => shipment.status === 'UNKNOWN',
  );

  if (hasUnknownShipment) {
    return plan('MANUAL_REVIEW');
  }

  const shipmentStarted = shipments.some((shipment) =>
    STARTED_SHIPMENT_STATUSES.includes(shipment.status),
  );

  // Физическая отправка важнее статуса оплаты
  // при выборе логистического сценария.
  if (order.status === 'SHIPPED' || shipmentStarted) {
    return plan('INTERCEPT_DELIVERY');
  }

  // Платёж находится в обработке.
  //
  // Отсутствие SUCCEEDED ещё не означает,
  // что платёж не завершится успешно.
  const hasPendingPayment = order.payments.some(
    (payment) => payment.status === 'PENDING',
  );

  if (hasPendingPayment) {
    return plan('MANUAL_REVIEW');
  }

  if (hasSucceededPayment) {
    // В нашей модели — полная предоплата
    // одним успешным платежом.
    //
    // Несколько успешных платежей или
    // несовпадение суммы требуют сверки.
    const paymentIsConsistent =
      successfulPayments.length === 1 &&
      successfulPayments[0].amount === order.finalAmount &&
      order.paymentType === 'CARD';

    if (!paymentIsConsistent) {
      return plan('MANUAL_REVIEW');
    }

    return plan('REFUND_BEFORE_SHIPPING');
  }

  // PAID / PROCESSING без успешного платежа —
  // противоречие в данных при обязательной
  // предоплате.
  //
  // Автоматически отменять такой заказ нельзя.
  if (order.status === 'PAID' || order.status === 'PROCESSING') {
    return plan('MANUAL_REVIEW');
  }

  // Только неоплаченные заказы могут идти
  // через существующую автоматическую отмену.
  //
  // PENDING_PAYMENT здесь допускается лишь
  // при отсутствии незавершённых и успешных
  // записей Payment.
  if (CANCELLABLE_ORDER_STATUSES.includes(order.status)) {
    return plan('DIRECT_CANCEL');
  }

  return plan('MANUAL_REVIEW');
}

export function getOrderCancellationEligibility(
  order: OrderRecord,
): OrderCancellationEligibility {
  const { route } = getOrderCancellationPlan(order);

  switch (route) {
    case 'DIRECT_CANCEL':
      return {
        allowed: true,
        reason: 'ALLOWED',
      };

    case 'ALREADY_CANCELLED':
      return {
        allowed: false,
        reason: 'ALREADY_CANCELLED',
      };

    case 'INTERCEPT_DELIVERY':
      return {
        allowed: false,
        reason: 'ALREADY_SHIPPED',
      };

    case 'RETURN_AFTER_DELIVERY':
      return {
        allowed: false,
        reason: 'ALREADY_DELIVERED',
      };

    case 'REFUND_BEFORE_SHIPPING':
    case 'FINALIZE_RETURN':
      return {
        allowed: false,
        reason: 'REFUND_REQUIRED',
      };

    case 'MANUAL_REVIEW':
      return {
        allowed: false,
        reason: 'UNSUPPORTED_STATUS',
      };
  }
}
