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
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { UserModule } from '../../user/user.module';

@Module({
  imports: [MailModule, forwardRef(() => AuthModule), PrismaModule, UserModule],
  controllers: [EmailConfirmationController],
  providers: [
    EmailConfirmationService,
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
