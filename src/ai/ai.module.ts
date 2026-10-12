import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../core/prisma/prisma.module';

@Module({
  controllers: [AiController],
  imports: [ConfigModule, PrismaModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
