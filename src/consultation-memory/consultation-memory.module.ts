import { Module } from '@nestjs/common';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { ConsultationMemoryService } from './consultation-memory.service';

@Module({
  imports: [PrismaModule],
  providers: [ConsultationMemoryService],
  exports: [ConsultationMemoryService],
})
export class ConsultationMemoryModule {}
