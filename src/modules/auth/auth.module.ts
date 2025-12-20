import { forwardRef, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getJwtConfig } from '@/src/core/config/jwt.config';
import { PrismaService } from '@/src/core/prisma/prisma.service';

import { YandexStrategy } from './strategies/yandex.strategy';

import { JwtStrategy } from './strategies/jwt.strategy';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { VkStrategy } from './strategies/vk.strategy';
import { EmailConfirmationService } from './email-confirmation/email-confirmation.service';
import { EmailConfirmationModule } from './email-confirmation/email-confirmation.module';
import { MailService } from '@/src/mail/mail.service';
// import { EmailConfirmationService } from './email-confirmation/email-confirmation.service';
// import { EmailConfirmationModule } from './email-confirmation/email-confirmation.module';

@Module({
  imports: [
    forwardRef(() => UserModule),
    forwardRef(() => EmailConfirmationModule),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    MailService,
    EmailConfirmationService,
    JwtStrategy,
    YandexStrategy,
    JwtAuthGuard,
    VkStrategy,
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
