import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { OrderStatus, PaymentStatus, PaymentType } from '@prisma/generated';

import { describe, expect, it, jest } from '@jest/globals';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { CurrentStoreOrderAdapter } from '../adapters/current-store-order.adapter';

import { OrdersService } from '../orders.service';

const integrationEnabled = process.env.RUN_ORDERS_DB_INTEGRATION === '1';

(integrationEnabled ? describe : describe.skip)(
  'Orders: shipment requires real confirmed prepayment',
  () => {
    jest.setTimeout(30000);

    it('rejects unpaid shipment and permits paid shipment lifecycle', async () => {
      const prisma = new PrismaService();

      const userId = randomUUID();

      await prisma.$connect();

      try {
        const user = await prisma.user.create({
          data: {
            id: userId,
            name: 'Shipment Prepayment Integration',
          },
        });

        const order = await prisma.order.create({
          data: {
            userId: user.id,

            cartId: randomUUID(),

            items: [],

            totalAmount: 12000,

            finalAmount: 12000,

            paymentType: PaymentType.CARD,

            status: OrderStatus.PROCESSING,
          },
        });

        const adapter = new CurrentStoreOrderAdapter(prisma);

        const service = new OrdersService(adapter, prisma);

        // Сначала проверяем отрицательный сценарий:
        // статус PROCESSING есть, а успешной
        // оплаты в базе нет.

        await expect(
          service.createOrderShipment(order.id, {
            provider: 'SDEK',
            status: 'IN_TRANSIT',
            trackingNumber: 'TEST-TRACK-123',
          }),
        ).rejects.toThrow(
          'Нельзя оформить отправление без подтверждённой полной оплаты заказа',
        );

        expect(
          await prisma.shipment.count({
            where: {
              orderId: order.id,
            },
          }),
        ).toBe(0);

        // Теперь фиксируем подтверждённую оплату.
        // Это тестовая запись PostgreSQL,
        // никакого запроса в настоящую ЮKassa нет.

        await prisma.payment.create({
          data: {
            orderId: order.id,

            providerPaymentId: `test-${randomUUID()}`,

            amount: 12000,

            status: PaymentStatus.SUCCEEDED,

            paidAt: new Date(),
          },
        });

        const shipment = await service.createOrderShipment(order.id, {
          provider: 'SDEK',
          status: 'PENDING',
          trackingNumber: 'TEST-TRACK-123',
        });

        expect(shipment.status).toBe('PENDING');

        const shipped = await service.updateOrderShipment(
          order.id,
          shipment.id,
          {
            status: 'SHIPPED',
          },
        );

        expect(shipped.status).toBe('SHIPPED');

        const inTransit = await service.updateOrderShipment(
          order.id,
          shipment.id,
          {
            status: 'IN_TRANSIT',
          },
        );

        expect(inTransit.status).toBe('IN_TRANSIT');

        const delivered = await service.updateOrderShipment(
          order.id,
          shipment.id,
          {
            status: 'DELIVERED',
          },
        );

        expect(delivered.status).toBe('DELIVERED');

        // Читаем итог через OrderPort,
        // а не только напрямую через Prisma.

        const result = await service.getOrderById(userId, order.id);

        expect(result.status).toBe('DELIVERED');

        expect(result.shipments).toHaveLength(1);

        expect(result.shipments[0].status).toBe('DELIVERED');

        expect(result.shipments[0].trackingNumber).toBe('TEST-TRACK-123');
      } finally {
        try {
          // Удаляем только пользователя,
          // созданного конкретно этим тестом.
          // Связанные заказы, платежи и отправления
          // удаляются по каскадным связям.
          await prisma.user.deleteMany({
            where: {
              id: userId,
            },
          });
        } finally {
          await prisma.$disconnect();
        }
      }
    });
  },
);
