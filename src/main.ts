import { NestFactory } from '@nestjs/core';
import { AppModule } from './core/app.module';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// import * as cookieParser from 'cookie-parser';
import cookieParser from 'cookie-parser';
import * as qs from 'qs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  console.log('🔥 Nest стартует');
  const config = app.get(ConfigService);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  app.use(
    'query parser',
    (str: string) => qs.parse(str, { arrayLimit: 100, comma: true }), // comma=true: поддержка brand=Nike,Adidas
  );
  app.use(cookieParser());
  app.use((req, _res, next) => {
    if (req.path === '/user/me') {
      console.log('Request Cookie header:', req.headers.cookie);
      console.log('Parsed cookies:', req.cookies); // должен быть accessToken
    }
    next();
  });
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
