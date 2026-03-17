import { Module } from '@nestjs/common';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { getYookassaConfig } from '../core/config/getYookassaConfig';
import { YookassaModule } from 'nestjs-yookassa';
import { PrismaService } from '../core/prisma/prisma.service';
import { YoomoneyController } from './yoomoney.controller';
import { YoomoneyService } from './yookassa.service';

@Module({
  imports: [
    YookassaModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getYookassaConfig,
      inject: [ConfigService],
    }),
  ],
  controllers: [YoomoneyController],
  providers: [YoomoneyService, PrismaService],
})
export class YoomoneyModule {}
