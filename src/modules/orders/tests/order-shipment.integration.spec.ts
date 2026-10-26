import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';

import { DeliveryProvider, OrderStatus, PaymentType } from '@prisma/generated';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { CurrentStoreOrderAdapter } from '../adapters/current-store-order.adapter';

import { OrdersService } from '../orders.service';

const integrationEnabled = process.env.RUN_ORDERS_DB_INTEGRATION === '1';

(integrationEnabled ? describe : describe.skip)(
  'Orders: real PostgreSQL shipment integration',
  () => {
    jest.setTimeout(60000);

    it('persists shipment lifecycle and reads it through OrderPort', async () => {
      const connectionString = process.env.POSTGRES_URI;

      if (!connectionString) {
        throw new Error('POSTGRES_URI отсутствует в окружении');
      }

      const databaseUrl = new URL(connectionString);

      if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)) {
        throw new Error(
          'Интеграционный тест разрешён только для локальной PostgreSQL',
        );
      }

      const prisma = new PrismaService();

      const testUserId = randomUUID();

      await prisma.$connect();

      try {
        // 1. Создаём отдельного временного пользователя.

        await prisma.user.create({
          data: {
            id: testUserId,
            name: 'Order Shipment Integration Test',
          },
        });

        // 2. Создаём заказ в статусе PROCESSING.

        const order = await prisma.order.create({
          data: {
            userId: testUserId,

            cartId: `test-cart-${randomUUID()}`,

            items: [],

            totalAmount: 2000,

            finalAmount: 2000,

            status: OrderStatus.PROCESSING,

            paymentType: PaymentType.CASH,

            deliveryProvider: DeliveryProvider.SDEK,
          },
        });

        // 3. Используем настоящий Prisma-адаптер.

        const adapter = new CurrentStoreOrderAdapter(prisma);

        const ordersService = new OrdersService(adapter, prisma);

        const orderNumber = String(order.number);

        // 4. Проверяем исходное состояние.

        const initialOrder = await ordersService.getOrderByNumber(
          testUserId,
          orderNumber,
        );

        expect(initialOrder).not.toBeNull();

        expect(initialOrder?.status).toBe('PROCESSING');

        expect(initialOrder?.shipments).toEqual([]);

        // 5. Создаём первое отправление.

        const shipmentA = await ordersService.createOrderShipment(order.id, {
          provider: 'SDEK',

          status: 'PENDING',

          trackingNumber: 'TEST-TRACK-A',
        });

        expect(shipmentA.status).toBe('PENDING');

        // 6. Проверяем, что отправление реально записано в БД.

        const persistedShipment = await prisma.shipment.findUnique({
          where: {
            id: shipmentA.id,
          },
        });

        expect(persistedShipment).not.toBeNull();

        expect(persistedShipment?.orderId).toBe(order.id);

        expect(persistedShipment?.trackingNumber).toBe('TEST-TRACK-A');

        // 7. Получаем заказ через универсальный OrderPort.

        const orderWithShipment = await ordersService.getOrderByNumber(
          testUserId,
          orderNumber,
        );

        expect(orderWithShipment?.shipments).toHaveLength(1);

        expect(orderWithShipment?.shipments?.[0].trackingNumber).toBe(
          'TEST-TRACK-A',
        );

        expect(orderWithShipment?.status).toBe('PROCESSING');

        // 8. Проверяем изоляцию пользователей.

        const otherUserOrder = await ordersService.getOrderByNumber(
          randomUUID(),
          orderNumber,
        );

        expect(otherUserOrder).toBeNull();

        // 9. Переводим первое отправление в IN_TRANSIT.

        await ordersService.updateOrderShipment(order.id, shipmentA.id, {
          status: 'IN_TRANSIT',
        });

        const shippedOrder = await ordersService.getOrderByNumber(
          testUserId,
          orderNumber,
        );

        expect(shippedOrder?.status).toBe('SHIPPED');

        expect(shippedOrder?.shipments?.[0].status).toBe('IN_TRANSIT');

        // 10. Проверяем запрет обычной отмены
        // после начала доставки.

        const cancellation =
          await ordersService.getOrderCancellationEligibility(
            testUserId,
            order.id,
          );

        expect(cancellation.eligibility).toEqual({
          allowed: false,
          reason: 'ALREADY_SHIPPED',
        });

        // 11. Создаём второе отправление.

        const shipmentB = await ordersService.createOrderShipment(order.id, {
          provider: 'POSTAL',

          status: 'PENDING',

          trackingNumber: 'TEST-TRACK-B',
        });

        // 12. Первое доставлено, второе ещё ожидает.

        await ordersService.updateOrderShipment(order.id, shipmentA.id, {
          status: 'DELIVERED',
        });

        const partiallyDeliveredOrder = await ordersService.getOrderByNumber(
          testUserId,
          orderNumber,
        );

        expect(partiallyDeliveredOrder?.status).toBe('SHIPPED');

        expect(partiallyDeliveredOrder?.shipments).toHaveLength(2);

        // 13. Доставляем второе отправление.

        await ordersService.updateOrderShipment(order.id, shipmentB.id, {
          status: 'DELIVERED',
        });

        // 14. Проверяем финальное состояние.

        const deliveredOrder = await ordersService.getOrderByNumber(
          testUserId,
          orderNumber,
        );

        expect(deliveredOrder?.status).toBe('DELIVERED');

        expect(
          deliveredOrder?.shipments?.every(
            (shipment) => shipment.status === 'DELIVERED',
          ),
        ).toBe(true);

        // 15. Проверяем непосредственно таблицу order.

        const persistedOrder = await prisma.order.findUnique({
          where: {
            id: order.id,
          },
        });

        expect(persistedOrder?.status).toBe(OrderStatus.DELIVERED);

        expect(
          await prisma.shipment.count({
            where: {
              orderId: order.id,
            },
          }),
        ).toBe(2);
      } finally {
        // Создан только один временный пользователь.
        // Его заказы и отправления удаляются по Cascade.

        try {
          await prisma.user.deleteMany({
            where: {
              id: testUserId,
            },
          });
        } finally {
          await prisma.$disconnect();
        }
      }
    });
  },
);
