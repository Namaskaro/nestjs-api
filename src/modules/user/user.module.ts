import { forwardRef, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StorageService } from '../libs/storage/storage.service';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  ],
  controllers: [UserController],
  providers: [UserService, PrismaService, StorageService, ConfigService],
  exports: [UserService],
})
export class UserModule {}
