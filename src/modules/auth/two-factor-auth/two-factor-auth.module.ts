import { Module } from '@nestjs/common';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { MailModule } from '@/src/mail/mail.module';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [TwoFactorAuthService],
  exports: [TwoFactorAuthService],
})
export class TwoFactorAuthModule {}
