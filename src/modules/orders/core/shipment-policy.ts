import type { ShipmentStatus } from './order-record.schema';

const ALLOWED_SHIPMENT_TRANSITIONS: Record<
  ShipmentStatus,
  readonly ShipmentStatus[]
> = {
  UNKNOWN: [
    'PENDING',
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
    'RETURNED',
  ],

  PENDING: [
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
  ],

  SHIPPED: [
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
    'RETURNED',
  ],

  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'],

  OUT_FOR_DELIVERY: ['DELIVERED', 'EXCEPTION', 'RETURNED'],

  EXCEPTION: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED'],

  DELIVERED: [],

  RETURNED: [],
};

export function canTransitionShipmentStatus(
  currentStatus: ShipmentStatus,
  nextStatus: ShipmentStatus,
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  return ALLOWED_SHIPMENT_TRANSITIONS[currentStatus].includes(nextStatus);
}
