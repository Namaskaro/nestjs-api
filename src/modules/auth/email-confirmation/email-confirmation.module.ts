import { forwardRef, Module } from '@nestjs/common';
import {
  EmailConfirmationService,
  RESEND_TOKEN,
} from './email-confirmation.service';
import { EmailConfirmationController } from './email-confirmation.controller';
import { Resend } from 'resend';
import { ConfigService } from '@nestjs/config';
import { MailModule } from '@/src/mail/mail.module';
import { AuthModule } from '../auth.module';
import { UserService } from '../../user/user.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { MailService } from '@/src/mail/mail.service';
import { AuthService } from '../auth.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [MailModule, forwardRef(() => AuthModule)],
  controllers: [EmailConfirmationController],
  providers: [
    EmailConfirmationService,
    PrismaService,
    MailService,
    AuthService,
    JwtService,
    UserService,
    {
      provide: RESEND_TOKEN,
      useFactory: (configService: ConfigService) =>
        new Resend(configService.get<string>('RESEND_API_KEY')),
      inject: [ConfigService],
    },
  ],
  exports: [EmailConfirmationService, RESEND_TOKEN],
})
export class EmailConfirmationModule {}
