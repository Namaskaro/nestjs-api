import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/generated';
import request from 'supertest';

// Как в существующих HTTP-тестах Orders: JWT подменяется только в тестовом приложении.
// Проверяется подключение guard, маршрутизация и настоящий RolesGuard, не криптография JWT.
jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));
// Каталог читается без создания AI/S3 клиентов и внешних вызовов.
jest.mock('@/src/ai/ai.service', () => ({ AiService: class AiService {} }));
jest.mock('@/src/cloud-storage/cloud-storage.service', () => ({
  CloudStorageService: class CloudStorageService {},
}));

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReviewsController } from './reviews.controller';
import { ReviewModerationController } from './review-moderation.controller';
import { ReviewsService } from './reviews.service';
import { ProductsService } from '../products/products.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { publicReviewsQuery } from './review-publication';

const productId = '00000000-0000-4000-8000-000000000001';
const reviewId = '00000000-0000-4000-8000-000000000002';
const publicationId = '00000000-0000-4000-8000-000000000003';
const identities = {
  admin: Role.Admin,
  manager: Role.Manager,
  client: Role.Client,
};
const testAuthGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const identity = req.headers['x-test-identity'];
    if (!Object.hasOwn(identities, identity)) throw new UnauthorizedException();
    req.user = { id: identity, role: identities[identity] };
    return true;
  },
};

describe('Reviews HTTP: авторизация, роли и неизменяемость', () => {
  let app: INestApplication;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = Object.fromEntries(
      [
        'createReview',
        'getProductReviews',
        'getMineAndEligibility',
        'addAddendum',
        'deleteReview',
        'getModerationQueue',
        'moderateReview',
        'moderateAddendum',
      ].map((method) => [method, jest.fn().mockResolvedValue({ ok: true })]),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ReviewModerationController, ReviewsController],
      providers: [{ provide: ReviewsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(testAuthGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('не разрешает неавторизованные записи и чтение своей заявки', async () => {
    await request(app.getHttpServer())
      .post('/reviews/create')
      .send({ productId, text: 'Текст', rating: 4 })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/reviews/${productId}/mine`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/reviews/${reviewId}/addenda`)
      .send({ publicationId, text: 'Текст' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/reviews/${reviewId}`)
      .query({ publicationId })
      .expect(401);
    expect(service.createReview).not.toHaveBeenCalled();
  });

  it('определяет автора по JWT и отбрасывает переданные userId/status', async () => {
    await request(app.getHttpServer())
      .post('/reviews/create')
      .set('x-test-identity', 'client')
      .send({
        productId,
        text: ' Текст ',
        rating: 4,
        userId: 'victim',
        status: 'PUBLISHED',
      })
      .expect(201);
    expect(service.createReview).toHaveBeenCalledWith('client', {
      productId,
      text: 'Текст',
      rating: 4,
    });
  });

  it.each([undefined, 0, 6, 2.5, '4'])(
    'проверяет обязательный целочисленный rating: %s',
    async (rating) => {
      await request(app.getHttpServer())
        .post('/reviews/create')
        .set('x-test-identity', 'client')
        .send({ productId, text: 'Текст', rating })
        .expect(400);
      expect(service.createReview).not.toHaveBeenCalled();
    },
  );

  it('валидирует текст и UUID до вызова сервиса', async () => {
    await request(app.getHttpServer())
      .post('/reviews/create')
      .set('x-test-identity', 'client')
      .send({ productId, text: '  ', rating: 4 })
      .expect(400);
    await request(app.getHttpServer()).get('/reviews/not-a-uuid').expect(400);
    await request(app.getHttpServer())
      .delete(`/reviews/${reviewId}`)
      .set('x-test-identity', 'client')
      .expect(400);
  });

  it.each(['admin', 'manager'])(
    'допускает %s к очереди и модерации обоих типов материалов',
    async (identity) => {
      await request(app.getHttpServer())
        .get('/reviews/moderation')
        .query({ kind: 'addendum' })
        .set('x-test-identity', identity)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/reviews/moderation/reviews/${reviewId}`)
        .set('x-test-identity', identity)
        .send({ publicationId, decision: 'PUBLISHED' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/reviews/moderation/addenda/${reviewId}`)
        .set('x-test-identity', identity)
        .send({ publicationId, decision: 'REJECTED', reason: 'Спам' })
        .expect(200);
      expect(service.getModerationQueue).toHaveBeenCalledWith('addendum');
      expect(service.moderateReview).toHaveBeenCalledWith(identity, reviewId, {
        publicationId,
        decision: 'PUBLISHED',
      });
      expect(service.moderateAddendum).toHaveBeenCalledWith(
        identity,
        reviewId,
        { publicationId, decision: 'REJECTED', reason: 'Спам' },
      );
    },
  );

  it('запрещает клиенту и гостю все маршруты модерации', async () => {
    for (const identity of [undefined, 'client']) {
      for (const path of [null, 'reviews', 'addenda']) {
        const query = path
          ? request(app.getHttpServer())
              .patch(`/reviews/moderation/${path}/${reviewId}`)
              .send({ publicationId, decision: 'PUBLISHED' })
          : request(app.getHttpServer()).get('/reviews/moderation');
        if (identity) query.set('x-test-identity', identity);
        await query.expect(identity ? 403 : 401);
      }
    }
    expect(service.moderateReview).not.toHaveBeenCalled();
  });

  it('передаёт идентичность публикации при дополнении и удалении; публичное чтение открыто', async () => {
    await request(app.getHttpServer())
      .post(`/reviews/${reviewId}/addenda`)
      .set('x-test-identity', 'client')
      .send({ publicationId, text: 'Позже.' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/reviews/${reviewId}`)
      .query({ publicationId })
      .set('x-test-identity', 'client')
      .expect(204);
    await request(app.getHttpServer()).get(`/reviews/${productId}`).expect(200);
    expect(service.addAddendum).toHaveBeenCalledWith('client', reviewId, {
      publicationId,
      text: 'Позже.',
    });
    expect(service.deleteReview).toHaveBeenCalledWith(
      'client',
      reviewId,
      publicationId,
    );
  });

  it('не предоставляет маршрутов редактирования текстов, голосования и статистики', async () => {
    await request(app.getHttpServer())
      .patch(`/reviews/${reviewId}`)
      .set('x-test-identity', 'client')
      .send({ text: 'Замена' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/reviews/${reviewId}/addenda/${reviewId}`)
      .set('x-test-identity', 'client')
      .send({ text: 'Замена' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/reviews/${reviewId}/vote`)
      .set('x-test-identity', 'client')
      .send({ value: 'UP' })
      .expect(404);
  });
});

describe('ProductsService: публичные вложенные reviews', () => {
  it('применяет опубликованный фильтр и проекцию во всех затронутых вариантах каталога', async () => {
    const publishedAt = new Date();
    const row = {
      id: productId,
      reviews: [
        {
          id: reviewId,
          publicationId,
          rating: 4,
          text: 'Текст',
          publishedAt,
          user: { id: 'buyer', name: 'Покупатель', image: null },
          addenda: [
            {
              id: 'old',
              publicationId: 'old',
              text: 'Прежняя публикация',
              createdAt: publishedAt,
              publishedAt,
            },
          ],
        },
      ],
    };
    const db = {
      product: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((queries) => Promise.all(queries)),
    };
    const products = new ProductsService(
      db as unknown as PrismaService,
      undefined!,
      undefined!,
      undefined!,
      undefined!,
      undefined!,
      undefined!,
      undefined!,
    );
    const all = await products.getAllProducts();
    const detail = await products.getProductById(productId);
    const gender = await products.getProductsByGender('MAN');
    const cursor = await products.getPaginatedProducts({ cursor: productId });
    const offset = await products.getPaginatedProducts({ page: 1 });
    for (const product of [
      all[0],
      detail,
      gender[0],
      cursor.items[0],
      offset.items[0],
    ]) {
      expect(product.reviews).toHaveLength(1);
      expect(product.reviews[0]).toMatchObject({
        verifiedPurchase: true,
        addenda: [],
        user: { id: 'buyer', name: 'Покупатель', image: null },
      });
    }
    for (const [query] of db.product.findMany.mock.calls)
      expect(query.include.reviews).toBe(publicReviewsQuery);
    expect(
      db.product.findUnique.mock.calls.find(([query]) => query.include)?.[0]
        .include.reviews,
    ).toBe(publicReviewsQuery);
  });
});
