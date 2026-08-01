import { Module } from '@nestjs/common';
import { PasswordRecoveryService } from './password-recovery.service';
import { PasswordRecoveryController } from './password-recovery.controller';

import { MailModule } from '@/src/mail/mail.module';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { UserModule } from '../../user/user.module';

@Module({
  imports: [PrismaModule, UserModule, MailModule],
  controllers: [PasswordRecoveryController],
  providers: [PasswordRecoveryService],
})
export class PasswordRecoveryModule {}
