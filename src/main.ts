import { NestFactory } from '@nestjs/core';
import { AppModule } from './core/app.module';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import * as qs from 'qs';
import IORedis from 'ioredis';

import session from 'express-session';
import { RedisStore } from 'connect-redis';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  console.log('🔥 Nest стартует');
  const config = app.get(ConfigService);
  // const redis = new IORedis(config.getOrThrow<string>('REDIS_URI'));

  const redisClient = new IORedis(config.getOrThrow('REDIS_URI'));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const redis = new IORedis({
    host: config.get<string>('REDIS_HOST'),
    port: Number(config.get<string>('REDIS_PORT')),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    username: config.get<string>('REDIS_USER') || undefined,
  });

  app.use(
    session({
      store: new RedisStore({ client: redis, prefix: 'sessions:' }),
      secret: config.get<string>('SESSION_SECRET') || 'supersecret',
      name: config.get<string>('SESSION_NAME') || 'guest_sid',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
      },
    }),
  );

  app.use('query parser', (str: string) =>
    qs.parse(str, { arrayLimit: 100, comma: true }),
  );
  app.use(cookieParser());

  app.useLogger(new Logger());
  app.enableCors({
    origin: [process.env.CLIENT_URL],
    credentials: true,
    exposedHeaders: 'set-cookie',
  });
  const options = new DocumentBuilder()
    .setTitle('Cats example')
    .setDescription('The cats API description')
    .setVersion('1.0')
    .addTag('cats')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api', app, documentFactory);
  await app.listen(5000);
}
bootstrap();
