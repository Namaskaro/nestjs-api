import { MailerService } from '@nestjs-modules/mailer';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/render';
import React from 'react';
import { Resend } from 'resend';
import { ConfirmationTemplate } from './emails/confirmation.template';

export const RESEND_TOKEN = 'RESEND_TOKEN';

@Injectable()
export class MailService {
  public constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    @Inject(RESEND_TOKEN) private readonly resend: Resend,
  ) {}

  public async sendConfirmationEmail(email: string, token: string) {
    const domain = this.configService.getOrThrow<string>('ALLOWED_ORIGIN');
    const html = await render(ConfirmationTemplate({ domain, token }));

    return this.sendEmail(
      'german.saratov@gmail.com',
      'Подтверждение почты',
      html,
    );
  }

  private async sendEmail(email: string, subject: string, html: string) {
    console.log('Resend:', this.resend);
    const result = await this.resend.emails.send({
      from: this.configService.get<string>('EMAIL_FROM'),
      to: email,
      subject,
      html,
    });
    console.log('Resend error', result);
  }
}
