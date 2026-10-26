import type { OrderRecord } from '../core/order-record.schema';

export interface OrderPort {
  getUserOrders(userId: string): Promise<OrderRecord[]>;

  getOrderById(userId: string, orderId: string): Promise<OrderRecord>;

  getOrderByNumber(
    userId: string,
    orderNumber: string,
  ): Promise<OrderRecord | null>;

  getLatestUserOrder(userId: string): Promise<OrderRecord | null>;

  cancelOrder(userId: string, orderId: string): Promise<OrderRecord | null>;
}

export const ORDER_PORT = Symbol('ORDER_PORT');
