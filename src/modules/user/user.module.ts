import { forwardRef, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StorageService } from '../libs/storage/storage.service';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import {
  EmailConfirmationService,
  RESEND_TOKEN,
} from '../auth/email-confirmation/email-confirmation.service';
import { Resend } from 'resend';
import { MailService } from '@/src/mail/mail.service';
import { ChatService } from '../chat/chat.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  ],
  controllers: [UserController],
  providers: [
    UserService,
    PrismaService,
    StorageService,
    ConfigService,

    {
      provide: RESEND_TOKEN,
      useFactory: (configService: ConfigService) =>
        new Resend(configService.get<string>('RESEND_API_KEY')),
      inject: [ConfigService],
    },
    MailService,
    ChatService,
  ],
  exports: [UserService],
})
export class UserModule {}
