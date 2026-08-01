import OpenAI from 'openai';
import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../core/prisma/prisma.module';

@Module({
  controllers: [AiController],
  imports: [ConfigModule, PrismaModule],
  providers: [
    AiService,
    {
      provide: OpenAI,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenAI({
          apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
        }),
    },
    {
      provide: 'YandexGPT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenAI({
          apiKey: config.getOrThrow<string>('YANDEX_API_KEY'),
          baseURL: config.getOrThrow<string>('YANDEX_API_URL'),
        }),
    },
  ],
  exports: [OpenAI, AiService],
})
export class AiModule {}
