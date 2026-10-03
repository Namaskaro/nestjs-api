export interface OrderPaymentRecord {
  id: number;

  createdAt: Date;
  updatedAt: Date;

  orderId: string;

  providerPaymentId: string;

  amount: number;
  status: string;

  paidAt: Date | null;

  rawResponse: unknown;
}

export interface OrderRecord {
  id: string;

  createdAt: Date;
  updatedAt: Date;

  userId: string;

  token: string | null;

  totalAmount: number;
  finalAmount: number;

  status: string;

  cartId: string;

  items: unknown;

  fullName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  comment: string | null;

  deliveryDate: Date | null;
  deliveryFee: number | null;
  deliveryTime: string | null;
  deliveryProvider: string | null;

  paymentType: string;

  payments: OrderPaymentRecord[];
}

export interface OrderPort {
  getUserOrders(userId: string): Promise<OrderRecord[]>;

  getOrderById(userId: string, orderId: string): Promise<OrderRecord>;

  getLatestUserOrder(userId: string): Promise<OrderRecord | null>;
}

export const ORDER_PORT = Symbol('ORDER_PORT');
