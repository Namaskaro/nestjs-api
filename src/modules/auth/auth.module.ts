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
import { EmailConfirmationModule } from './email-confirmation/email-confirmation.module';
import { ChatModule } from '../chat/chat.module';
import { MailModule } from '@/src/mail/mail.module';
import { PrismaModule } from '@/src/core/prisma/prisma.module';
import { TwoFactorAuthService } from './two-factor-auth/two-factor-auth.service';

@Module({
  imports: [
    PrismaModule,
    UserModule,
    EmailConfirmationModule,
    forwardRef(() => ChatModule), // если есть цикл
    MailModule, // обычный импорт
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
    JwtAuthGuard,

    JwtStrategy,
    YandexStrategy,
    VkStrategy,
    TwoFactorAuthService,
  ],
  exports: [JwtModule, AuthService, JwtAuthGuard],
})
export class AuthModule {}
