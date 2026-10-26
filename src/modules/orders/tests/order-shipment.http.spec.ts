import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';

import { Test } from '@nestjs/testing';

import { Role } from '@prisma/generated';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import request from 'supertest';

// Изолируем JwtAuthGuard на уровне импорта.
//
// Без этого Jest загружает настоящий AuthService,
// а вместе с ним EmailConfirmationService и MailService.
//
// В данном тесте реальная JWT-аутентификация не нужна:
// мы проверяем маршруты, роли и валидацию HTTP-запросов.
jest.mock('@/src/modules/auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { JwtAuthGuard } from '@/src/modules/auth/guards/jwt-auth.guard';

import { OrdersController } from '../orders.controller';

import { OrdersService } from '../orders.service';

const TEST_USERS = {
  admin: {
    id: 'admin-1',
    role: Role.Admin,
  },

  client: {
    id: 'client-1',
    role: Role.Client,
  },

  other: {
    id: 'client-2',
    role: Role.Client,
  },
};

type TestIdentity = keyof typeof TEST_USERS;

interface TestHttpRequest {
  headers: {
    'x-test-identity'?: string;
  };

  user?: {
    id: string;
    role: Role;
  };
}

// Подменяет реальную JWT-аутентификацию.
//
// Вместо токена читает тестовый заголовок,
// определяет пользователя и записывает его в request.user.
//
// Используется только внутри тестового приложения.
const testAuthGuard: CanActivate = {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest<TestHttpRequest>();

    const identity = httpRequest.headers['x-test-identity'];

    if (!identity || !(identity in TEST_USERS)) {
      throw new UnauthorizedException('Тестовый пользователь не авторизован');
    }

    httpRequest.user = TEST_USERS[identity as TestIdentity];

    return true;
  },
};

const SHIPMENT = {
  id: 'shipment-1',

  provider: 'SDEK',

  status: 'IN_TRANSIT',

  trackingNumber: 'TRACK-123',

  trackingUrl: null,

  estimatedDeliveryAt: null,

  shippedAt: null,

  deliveredAt: null,
};

function createOrdersServiceMock() {
  return {
    createOrderShipment: jest.fn(),

    updateOrderShipment: jest.fn(),

    getOrderById: jest.fn(),
  };
}

describe('OrdersController: shipment HTTP authorization', () => {
  let app: INestApplication;

  let ordersService: ReturnType<typeof createOrdersServiceMock>;

  beforeEach(async () => {
    ordersService = createOrdersServiceMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],

      providers: [
        {
          provide: OrdersService,
          useValue: ordersService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(testAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('ADMIN: allows creating a shipment', async () => {
    ordersService.createOrderShipment.mockResolvedValue(SHIPMENT as never);

    const body = {
      provider: 'SDEK',

      status: 'IN_TRANSIT',

      trackingNumber: 'TRACK-123',
    };

    const response = await request(app.getHttpServer())
      .post('/orders/order-1/shipments')
      .set('x-test-identity', 'admin')
      .send(body)
      .expect(201);

    expect(response.body).toMatchObject({
      id: 'shipment-1',

      status: 'IN_TRANSIT',

      trackingNumber: 'TRACK-123',
    });

    expect(ordersService.createOrderShipment).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining(body),
    );
  });

  it('ADMIN: allows updating a shipment', async () => {
    ordersService.updateOrderShipment.mockResolvedValue({
      ...SHIPMENT,

      status: 'DELIVERED',
    } as never);

    const response = await request(app.getHttpServer())
      .patch('/orders/order-1/shipments/shipment-1')
      .set('x-test-identity', 'admin')
      .send({
        status: 'DELIVERED',
      })
      .expect(200);

    expect(response.body.status).toBe('DELIVERED');

    expect(ordersService.updateOrderShipment).toHaveBeenCalledWith(
      'order-1',
      'shipment-1',
      expect.objectContaining({
        status: 'DELIVERED',
      }),
    );
  });

  it('CLIENT: cannot create a shipment', async () => {
    await request(app.getHttpServer())
      .post('/orders/order-1/shipments')
      .set('x-test-identity', 'client')
      .send({
        provider: 'SDEK',
        status: 'DELIVERED',
      })
      .expect(403);

    expect(ordersService.createOrderShipment).not.toHaveBeenCalled();
  });

  it('CLIENT: cannot update shipment status', async () => {
    await request(app.getHttpServer())
      .patch('/orders/order-1/shipments/shipment-1')
      .set('x-test-identity', 'client')
      .send({
        status: 'DELIVERED',
      })
      .expect(403);

    expect(ordersService.updateOrderShipment).not.toHaveBeenCalled();
  });

  it('CLIENT: can read shipments of own order', async () => {
    ordersService.getOrderById.mockResolvedValue({
      id: 'order-1',

      userId: 'client-1',

      shipments: [SHIPMENT],
    } as never);

    const response = await request(app.getHttpServer())
      .get('/orders/order-1/shipments')
      .set('x-test-identity', 'client')
      .expect(200);

    expect(response.body).toHaveLength(1);

    expect(response.body[0]).toMatchObject({
      trackingNumber: 'TRACK-123',

      status: 'IN_TRANSIT',
    });

    expect(ordersService.getOrderById).toHaveBeenCalledWith(
      'client-1',
      'order-1',
    );
  });

  it('CLIENT: cannot read a different user order', async () => {
    ordersService.getOrderById.mockImplementation(
      async (userId: string, orderId: string) => {
        if (userId !== 'client-1' || orderId !== 'order-1') {
          throw new NotFoundException('Заказ не найден');
        }

        return {
          shipments: [SHIPMENT],
        };
      },
    );

    await request(app.getHttpServer())
      .get('/orders/order-1/shipments')
      .set('x-test-identity', 'other')
      .expect(404);

    expect(ordersService.getOrderById).toHaveBeenCalledWith(
      'client-2',
      'order-1',
    );
  });

  it('ANONYMOUS: cannot read shipments', async () => {
    await request(app.getHttpServer())
      .get('/orders/order-1/shipments')
      .expect(401);

    expect(ordersService.getOrderById).not.toHaveBeenCalled();
  });

  it('ANONYMOUS: cannot create shipments', async () => {
    await request(app.getHttpServer())
      .post('/orders/order-1/shipments')
      .send({
        provider: 'SDEK',
      })
      .expect(401);

    expect(ordersService.createOrderShipment).not.toHaveBeenCalled();
  });

  it('VALIDATION: rejects unsupported shipment status', async () => {
    await request(app.getHttpServer())
      .post('/orders/order-1/shipments')
      .set('x-test-identity', 'admin')
      .send({
        provider: 'SDEK',

        status: 'TELEPORTED',
      })
      .expect(400);

    expect(ordersService.createOrderShipment).not.toHaveBeenCalled();
  });

  it('VALIDATION: rejects invalid tracking URL', async () => {
    await request(app.getHttpServer())
      .post('/orders/order-1/shipments')
      .set('x-test-identity', 'admin')
      .send({
        provider: 'SDEK',

        trackingUrl: 'not-a-valid-url',
      })
      .expect(400);

    expect(ordersService.createOrderShipment).not.toHaveBeenCalled();
  });
});
