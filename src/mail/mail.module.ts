import { Module } from '@nestjs/common';
import { MailService, RESEND_TOKEN } from './mail.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getMailerConfig } from '../core/config/mailer.config';
import { Resend } from 'resend';

@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getMailerConfig,
      inject: [ConfigService],
    }),
  ],
  providers: [
    MailService,

    {
      provide: RESEND_TOKEN,
      useFactory: (configService: ConfigService) =>
        new Resend(configService.get<string>('RESEND_API_KEY')),
      inject: [ConfigService],
    },
  ],
  exports: [MailService],
})
export class MailModule {}
