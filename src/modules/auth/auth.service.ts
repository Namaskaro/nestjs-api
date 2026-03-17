import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { AuthDto } from '../user/dto/auth.dto';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@/prisma/generated';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdateUserDto } from '../user/dto/user-update.dto';
import type { Response as ExpressResponse } from 'express';
import { EmailConfirmationService } from './email-confirmation/email-confirmation.service';
import * as argon2 from 'argon2';

const TTL_MS = 1000 * 60 * 1000;
const EXPIRE_DAY_REFRESH_TOKEN = 1;
export const ACCESS_TOKEN_NAME = 'accessToken';
export const REFRESH_TOKEN_NAME = 'refreshToken';
export const GUEST_ACCESS_TOKEN_NAME = 'gAccessToken';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly jwt: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly emailConfirmationService: EmailConfirmationService,
  ) {
    this.accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!this.accessSecret || !this.refreshSecret) {
      // Жёстко валимся на старте, чтобы не ловить 500 в рантайме
      throw new Error('JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are not set');
    }
  }

  async createGuest() {
    const guest = await this.prismaService.user.create({
      data: {
        // id можно не передавать, если в Prisma стоит @default(uuid())
        role: Role.Guest,
        isGuest: true, // <—
        lastSeen: new Date(),
      },
      select: { id: true, name: true },
    });
    return guest;
  }

  async getGuest(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { id: true, name: true, isGuest: true },
    });
    if (!user) throw new NotFoundException('Гость не найден!');
    if (!user.isGuest)
      throw new GoneException('Гость апгрейжен до обычного пользователя');
    return { id: user.id, name: user.name ?? null };
  }

  async ping(id: string): Promise<void> {
    await this.prismaService.user.updateMany({
      where: { id, isGuest: true }, // <— только для гостей
      data: { lastSeen: new Date() },
    });
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - TTL_MS);
    const res = await this.prismaService.user.deleteMany({
      where: { isGuest: true, lastSeen: { lt: cutoff } },
    });
    return res.count;
  }

  async upgradeGuest(id: string, data: UpdateUserDto) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { isGuest: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    return this.prismaService.user.update({
      where: { id },
      data: { ...data, role: Role.Client, isGuest: false }, // <—
    });
  }

  async deleteGuest(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { isGuest: true },
    });
    if (!user) throw new NotFoundException('Гость не найден!');
    if (!user.isGuest) throw new GoneException('Это уже не гость');

    return this.prismaService.user.delete({ where: { id } });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cronPurge() {
    try {
      await this.purgeExpired();
    } catch {}
  }

  async login(dto: AuthDto) {
    const user = await this.validateUser(dto);
    const tokens = this.issueTokens(user);

    return {
      user,
      ...tokens,
    };
  }

  async register(dto: AuthDto) {
    const isUserExist = await this.userService.getByEmail(dto.email);

    if (isUserExist) {
      throw new BadRequestException({
        message: 'Пользователь с таким email уже существует',
      });
    }

    const user = await this.userService.create(dto);
    const tokens = this.issueTokens(user);
    console.log('Ебучая ошибка!!!');
    await this.emailConfirmationService.sendVerificationToken(user);

    return {
      ...tokens,
      message:
        'Вы успешно зарегистрировались. Пожалуйста подтвердите ваш email. Письмо было отправлено на ваш почтовый адрес',
    };
  }

  // private async validateUser(dto: AuthDto) {
  //   const user = await this.userService.getByEmail(dto.email);
  //   const isUserVerified = user.emailVerified;
  //   if (!user) {
  //     throw new NotFoundException({
  //       message: 'Пользователь с такой почтой не найден',
  //     });
  //   }

  //   if (user.email !== dto.email || user.password !== dto.password) {
  //     throw new UnauthorizedException({
  //       message: 'Неверная почта или пароль',
  //     });
  //   }

  //   if (!isUserVerified) {
  //     await this.emailConfirmationService.sendVerificationToken(user);
  //     throw new UnauthorizedException({
  //       message:
  //         'Ваш email не подтвержден. Пожалуйста, проверьте вашу почту и подтвердите адрес',
  //     });
  //   }

  //   return user;
  // }

  // ---------- SIGN HELPERS ----------

  private async validateUser(dto: AuthDto) {
    const user = await this.userService.getByEmail(dto.email);

    if (!user) {
      throw new NotFoundException({
        message: 'Пользователь с такой почтой не найден',
      });
    }

    const isPasswordValid = await argon2.verify(user.password, dto.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException({
        message: 'Неверная почта или пароль',
      });
    }

    if (!user.emailVerified) {
      await this.emailConfirmationService.sendVerificationToken(user);
      throw new UnauthorizedException({
        message:
          'Ваш email не подтвержден. Пожалуйста, проверьте вашу почту и подтвердите адрес',
      });
    }

    return user;
  }

  issueUserAccessToken(user: User) {
    return this.jwt.signAsync(
      { sub: user },
      { secret: this.accessSecret, expiresIn: '15m' },
    );
  }

  issueGuestAccessToken(guestId: string) {
    return this.jwt.signAsync(
      { sub: guestId, isGuest: true },
      { secret: this.accessSecret, expiresIn: '14d' },
    );
  }

  issueRefreshToken(userId: string) {
    return this.jwt.signAsync(
      { sub: userId },
      { secret: this.refreshSecret, expiresIn: '7d' },
    );
  }

  // ---------- VERIFY HELPERS ----------
  verifyAccess<T extends object = any>(token: string) {
    return this.jwt.verifyAsync<T>(token, { secret: this.accessSecret });
  }

  verifyRefresh<T extends object = any>(token: string) {
    return this.jwt.verifyAsync<T>(token, { secret: this.refreshSecret });
  }

  verifyAny<T extends object = any>(token: string) {
    return this.verifyAccess<T>(token);
  }

  // ---------- ВАШИ МЕТОДЫ (исправленные) ----------

  // Было: sign без secret и payload {id}
  issueTokens(user: User) {
    // совместимость: оставляем метод, но внутри зовём корректные хелперы
    return {
      // если хочешь 1h — поменяй expiresIn в issueUserAccessToken
      accessToken: this.jwt.sign(
        { sub: user.id },
        { secret: this.accessSecret, expiresIn: '1h' },
      ),
      refreshToken: this.jwt.sign(
        { sub: user.id },
        { secret: this.refreshSecret, expiresIn: '7d' },
      ),
    };
  }

  // Было: verifyAsync(refreshToken) без secret + result.id
  async getNewTokens(refreshToken: string) {
    const result = await this.verifyRefresh<{ sub?: string; id?: string }>(
      refreshToken,
    );
    const userId = result.sub ?? result.id; // читаем и sub, и id (на случай старых токенов)
    if (!userId) throw new UnauthorizedException('Невалидный refresh токен');

    const user = await this.userService.getById(userId);

    // Можно использовать issueTokens (теперь он тоже с секретами)
    const accessToken = await this.issueUserAccessToken(user);
    const newRefresh = await this.issueRefreshToken(user.id);

    return { user, accessToken, refreshToken: newRefresh };
  }

  async validate0AuthLogin(
    req: Request | any,
    opts?: { provider?: string; providerAccountId?: string | number },
  ) {
    const u = (req as any).user || {};
    const provider = (u.provider ?? opts?.provider ?? 'oauth') as string;
    const providerAccountId = String(
      u.providerAccountId ?? opts?.providerAccountId ?? '',
    );

    let user = providerAccountId
      ? (
          await this.prismaService.account.findFirst({
            where: { provider, providerAccountId },
            include: { user: true },
          })
        )?.user || null
      : null;

    if (!user && u.email) {
      user = await this.prismaService.user.findFirst({
        where: { email: u.email },
      });
    }

    if (!user) {
      user = await this.prismaService.user.create({
        data: {
          email: u.email ?? null,
          name: u.name ?? 'Не указано',
          image: u.picture ?? u.avatar ?? '/uploads/no-user-image.png',
          isGuest: false,
          role: Role.Client,
        },
      });
    }

    if (provider && providerAccountId) {
      await this.prismaService.account.upsert({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        create: { provider, providerAccountId, type: 'oauth', userId: user.id },
        update: { userId: user.id },
      });
    }

    const accessToken = await this.issueUserAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    return { user, accessToken, refreshToken };
  }

  addAccessTokenToResponse(res: ExpressResponse, token: string) {
    console.log('🍪 БЭК ставит accessToken:', token.substring(0, 20) + '...');
    res.cookie(ACCESS_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
  }
  addRefreshTokenToResponse(res: ExpressResponse, token: string) {
    res.cookie(REFRESH_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  addGuestAccessTokenToResponse(res: ExpressResponse, token: string) {
    res.cookie(GUEST_ACCESS_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });
  }
  clearAccessTokens(res: ExpressResponse) {
    res.clearCookie(ACCESS_TOKEN_NAME, { path: '/' });
    res.clearCookie(GUEST_ACCESS_TOKEN_NAME, { path: '/' });
  }

  clearRefreshToken(res: ExpressResponse) {
    res.clearCookie(REFRESH_TOKEN_NAME, { path: '/' });
  }
}
