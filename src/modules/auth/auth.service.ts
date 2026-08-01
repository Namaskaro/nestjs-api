// import {
//   BadRequestException,
//   GoneException,
//   HttpException,
//   Injectable,
//   NotFoundException,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { PrismaService } from '../../core/prisma/prisma.service';
// import { JwtService } from '@nestjs/jwt';
// import { UserService } from '../user/user.service';
// import { AuthDto } from '../user/dto/auth.dto';
// import { ConfigService } from '@nestjs/config';
// import { Role, User } from '@/prisma/generated';
// import type { Response as ExpressResponse } from 'express';
// import { EmailConfirmationService } from './email-confirmation/email-confirmation.service';
// import * as argon2 from 'argon2';
// import { TwoFactorAuthService } from './two-factor-auth/two-factor-auth.service';

// export const ACCESS_TOKEN_NAME = 'accessToken';
// export const REFRESH_TOKEN_NAME = 'refreshToken';
// export const GUEST_ACCESS_TOKEN_NAME = 'gAccessToken';

// @Injectable()
// export class AuthService {
//   private readonly accessSecret: string;
//   private readonly refreshSecret: string;
//   public constructor(
//     private readonly prismaService: PrismaService,
//     private readonly jwt: JwtService,
//     private readonly userService: UserService,
//     private readonly configService: ConfigService,
//     private readonly emailConfirmationService: EmailConfirmationService,
//     private readonly twoFactorAuthService: TwoFactorAuthService,
//   ) {
//     this.accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
//     this.refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
//     if (!this.accessSecret || !this.refreshSecret) {
//       // Жёстко валимся на старте, чтобы не ловить 500 в рантайме
//       throw new Error('JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are not set');
//     }
//   }

//   async login(dto: AuthDto) {
//     const user = await this.validateUser(dto);
//     const tokens = this.issueTokens(user);

//     if (!user.emailVerified) {
//       await this.emailConfirmationService.sendVerificationToken(user.email);

//       throw new UnauthorizedException({
//         message:
//           'Ваш email не подтвержден. Пожалуйста проверьте вашу почту и подтвердите ваш почтовый адрес',
//         code: 'NOT_VERIFIED',
//       });
//     }

//     if (user.isTwoFactorEnabled) {
//       if (!dto.code) {
//         await this.twoFactorAuthService.sendTwoFactorToken(user.email);

//         throw new BadRequestException({
//           message:
//             'Код был отправлен на вашу почту. Пожалуйста проверьте вашу почту!',
//         });
//         // return {
//         //   message:
//         //     'Код был отправлен на вашу почту. Пожалуйста проверьте вашу почту!',
//         // };
//       }
//       await this.twoFactorAuthService.validateTwoFactorToken(
//         user.email,
//         dto.code,
//       );
//     }

//     return {
//       user,
//       ...tokens,
//     };
//   }

//   async register(dto: AuthDto) {
//     const isUserExist = await this.userService.getByEmail(dto.email);

//     if (isUserExist) {
//       throw new BadRequestException({
//         message: 'Пользователь с таким email уже существует',
//       });
//     }

//     const user = await this.userService.create(dto);
//     const tokens = this.issueTokens(user);
//     await this.emailConfirmationService.sendVerificationToken(user.email);

//     return {
//       ...tokens,
//       message:
//         'Вы успешно зарегистрировались. Пожалуйста подтвердите ваш email. Письмо было отправлено на ваш почтовый адрес',
//     };
//   }

//   // ---------- SIGN HELPERS ----------

//   // private async validateUser(dto: AuthDto) {
//   //   const user = await this.userService.getByEmail(dto.email);

//   //   if (!user) {
//   //     throw new NotFoundException({
//   //       message: 'Пользователь с такой почтой не найден',
//   //     });
//   //   }

//   //   const isPasswordValid = await argon2.verify(user.password, dto.password);

//   //   if (!isPasswordValid) {
//   //     throw new UnauthorizedException({
//   //       message: 'Неверная почта или пароль',
//   //     });
//   //   }

//   //   if (!user.emailVerified) {
//   //     await this.emailConfirmationService.sendVerificationToken(user.email);
//   //     throw new UnauthorizedException({
//   //       message:
//   //         'Ваш email не подтвержден. Пожалуйста, проверьте вашу почту и подтвердите адрес',
//   //     });
//   //   }

//   //   return user;
//   // }

//   private async validateUser(dto: AuthDto) {
//     const user = await this.userService.getByEmail(dto.email);

//     if (!user) {
//       throw new NotFoundException({
//         message: 'Пользователь с такой почтой не найден',
//       });
//     }

//     const isPasswordValid = await argon2.verify(user.password, dto.password);

//     if (!isPasswordValid) {
//       throw new UnauthorizedException({
//         message: 'Неверная почта или пароль',
//       });
//     }

//     return user;
//   }

//   issueUserAccessToken(user: User) {
//     return this.jwt.signAsync(
//       { sub: user },
//       { secret: this.accessSecret, expiresIn: '15m' },
//     );
//   }

//   issueGuestAccessToken(guestId: string) {
//     return this.jwt.signAsync(
//       { sub: guestId, isGuest: true },
//       { secret: this.accessSecret, expiresIn: '14d' },
//     );
//   }

//   issueRefreshToken(userId: string) {
//     return this.jwt.signAsync(
//       { sub: userId },
//       { secret: this.refreshSecret, expiresIn: '7d' },
//     );
//   }

//   // ---------- VERIFY HELPERS ----------
//   verifyAccess<T extends object = any>(token: string) {
//     return this.jwt.verifyAsync<T>(token, { secret: this.accessSecret });
//   }

//   verifyRefresh<T extends object = any>(token: string) {
//     return this.jwt.verifyAsync<T>(token, { secret: this.refreshSecret });
//   }

//   verifyAny<T extends object = any>(token: string) {
//     return this.verifyAccess<T>(token);
//   }

//   // ---------- ВАШИ МЕТОДЫ (исправленные) ----------

//   // Было: sign без secret и payload {id}
//   issueTokens(user: User) {
//     // совместимость: оставляем метод, но внутри зовём корректные хелперы
//     return {
//       // если хочешь 1h — поменяй expiresIn в issueUserAccessToken
//       accessToken: this.jwt.sign(
//         { sub: user.id },
//         { secret: this.accessSecret, expiresIn: '1h' },
//       ),
//       refreshToken: this.jwt.sign(
//         { sub: user.id },
//         { secret: this.refreshSecret, expiresIn: '7d' },
//       ),
//     };
//   }

//   // Было: verifyAsync(refreshToken) без secret + result.id
//   async getNewTokens(refreshToken: string) {
//     const result = await this.verifyRefresh<{ sub?: string; id?: string }>(
//       refreshToken,
//     );
//     const userId = result.sub ?? result.id; // читаем и sub, и id (на случай старых токенов)
//     if (!userId) throw new UnauthorizedException('Невалидный refresh токен');

//     const user = await this.userService.getById(userId);

//     // Можно использовать issueTokens (теперь он тоже с секретами)
//     const accessToken = await this.issueUserAccessToken(user);
//     const newRefresh = await this.issueRefreshToken(user.id);

//     return { user, accessToken, refreshToken: newRefresh };
//   }

//   async validate0AuthLogin(
//     req: Request | any,
//     opts?: { provider?: string; providerAccountId?: string | number },
//   ) {
//     const u = (req as any).user || {};
//     const provider = (u.provider ?? opts?.provider ?? 'oauth') as string;
//     const providerAccountId = String(
//       u.providerAccountId ?? opts?.providerAccountId ?? '',
//     );

//     let user = providerAccountId
//       ? (
//           await this.prismaService.account.findFirst({
//             where: { provider, providerAccountId },
//             include: { user: true },
//           })
//         )?.user || null
//       : null;

//     if (!user && u.email) {
//       user = await this.prismaService.user.findFirst({
//         where: { email: u.email },
//       });
//     }

//     if (!user) {
//       user = await this.prismaService.user.create({
//         data: {
//           email: u.email ?? null,
//           name: u.name ?? 'Не указано',
//           image: u.picture ?? u.avatar ?? '/uploads/no-user-image.png',
//           role: Role.Client,
//         },
//       });
//     }

//     if (provider && providerAccountId) {
//       await this.prismaService.account.upsert({
//         where: { provider_providerAccountId: { provider, providerAccountId } },
//         create: { provider, providerAccountId, type: 'oauth', userId: user.id },
//         update: { userId: user.id },
//       });
//     }

//     const accessToken = await this.issueUserAccessToken(user);
//     const refreshToken = await this.issueRefreshToken(user.id);

//     return { user, accessToken, refreshToken };
//   }

//   addAccessTokenToResponse(res: ExpressResponse, token: string) {
//     console.log('🍪 БЭК ставит accessToken:', token.substring(0, 20) + '...');
//     res.cookie(ACCESS_TOKEN_NAME, token, {
//       httpOnly: true,
//       sameSite: 'lax',
//       secure: false,
//       path: '/',
//       maxAge: 15 * 60 * 1000,
//     });
//   }
//   addRefreshTokenToResponse(res: ExpressResponse, token: string) {
//     res.cookie(REFRESH_TOKEN_NAME, token, {
//       httpOnly: true,
//       sameSite: 'lax',
//       secure: false,
//       path: '/',
//       maxAge: 7 * 24 * 60 * 60 * 1000,
//     });
//   }
//   addGuestAccessTokenToResponse(res: ExpressResponse, token: string) {
//     res.cookie(GUEST_ACCESS_TOKEN_NAME, token, {
//       httpOnly: true,
//       sameSite: 'lax',
//       secure: false,
//       path: '/',
//       maxAge: 14 * 24 * 60 * 60 * 1000,
//     });
//   }
//   clearAccessTokens(res: ExpressResponse) {
//     res.clearCookie(ACCESS_TOKEN_NAME, { path: '/' });
//     res.clearCookie(GUEST_ACCESS_TOKEN_NAME, { path: '/' });
//   }

//   clearRefreshToken(res: ExpressResponse) {
//     res.clearCookie(REFRESH_TOKEN_NAME, { path: '/' });
//   }
// }

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Request, Response as ExpressResponse } from 'express';

import * as argon2 from 'argon2';

import { Role, User } from '@/prisma/generated';

import { PrismaService } from '../../core/prisma/prisma.service';

import { UserService } from '../user/user.service';
import { AuthDto } from '../user/dto/auth.dto';

import { EmailConfirmationService } from './email-confirmation/email-confirmation.service';
import { TwoFactorAuthService } from './two-factor-auth/two-factor-auth.service';

export const ACCESS_TOKEN_NAME = 'accessToken';

export const REFRESH_TOKEN_NAME = 'refreshToken';

export const GUEST_ACCESS_TOKEN_NAME = 'gAccessToken';

export type SafeUser = Omit<User, 'password'>;

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly isProduction: boolean;

  public constructor(
    private readonly prismaService: PrismaService,

    private readonly jwt: JwtService,

    private readonly userService: UserService,

    private readonly configService: ConfigService,

    private readonly emailConfirmationService: EmailConfirmationService,

    private readonly twoFactorAuthService: TwoFactorAuthService,
  ) {
    this.accessSecret =
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');

    this.refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
  }

  async login(dto: AuthDto) {
    const user = await this.validateUser(dto);

    if (!user.emailVerified) {
      await this.emailConfirmationService.sendVerificationToken(user.email);

      throw new UnauthorizedException({
        message:
          'Ваш email не подтвержден. Пожалуйста проверьте вашу почту и подтвердите ваш почтовый адрес',
        code: 'NOT_VERIFIED',
      });
    }

    if (user.isTwoFactorEnabled) {
      if (!dto.code) {
        await this.twoFactorAuthService.sendTwoFactorToken(user.email);

        throw new BadRequestException({
          message:
            'Код был отправлен на вашу почту. Пожалуйста проверьте вашу почту!',
        });
      }

      await this.twoFactorAuthService.validateTwoFactorToken(
        user.email,
        dto.code,
      );
    }

    const tokens = await this.issueTokens(user);

    return {
      user: this.toSafeUser(user),
      ...tokens,
    };
  }

  async register(dto: AuthDto) {
    const existingUser = await this.userService.getByEmail(dto.email);

    if (existingUser) {
      throw new BadRequestException({
        message: 'Пользователь с таким email уже существует',
      });
    }

    const user = await this.userService.create(dto);

    await this.emailConfirmationService.sendVerificationToken(user.email);

    return {
      message:
        'Вы успешно зарегистрировались. Пожалуйста подтвердите ваш email. Письмо было отправлено на ваш почтовый адрес',
    };
  }

  async getCurrentUser(userId: string): Promise<SafeUser> {
    const user = await this.userService.getById(userId);

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return this.toSafeUser(user);
  }

  // async issueUserAccessToken(user: User): Promise<string> {
  //   return this.jwt.signAsync(
  //     {
  //       sub: user.id,
  //     },
  //     {
  //       secret: this.accessSecret,
  //       expiresIn: '15m',
  //     },
  //   );
  // }

  // async issueGuestAccessToken(guestId: string): Promise<string> {
  //   return this.jwt.signAsync(
  //     {
  //       sub: guestId,
  //       isGuest: true,
  //     },
  //     {
  //       secret: this.accessSecret,
  //       expiresIn: '14d',
  //     },
  //   );
  // }

  // async issueRefreshToken(userId: string): Promise<string> {
  //   return this.jwt.signAsync(
  //     {
  //       sub: userId,
  //     },
  //     {
  //       secret: this.refreshSecret,
  //       expiresIn: '7d',
  //     },
  //   );
  // }

  // async issueTokens(user: User) {
  //   const [accessToken, refreshToken] = await Promise.all([
  //     this.issueUserAccessToken(user),
  //     this.issueRefreshToken(user.id),
  //   ]);

  //   return {
  //     accessToken,
  //     refreshToken,
  //   };
  // }

  // verifyAccess<
  //   T extends object = {
  //     sub: string;
  //   },
  // >(token: string) {
  //   return this.jwt.verifyAsync<T>(token, {
  //     secret: this.accessSecret,
  //   });
  // }

  // verifyRefresh<
  //   T extends object = {
  //     sub: string;
  //   },
  // >(token: string) {
  //   return this.jwt.verifyAsync<T>(token, {
  //     secret: this.refreshSecret,
  //   });
  // }

  // async getNewTokens(refreshToken: string) {
  //   const payload = await this.verifyRefresh<{
  //     sub: string;
  //   }>(refreshToken);

  //   if (!payload.sub) {
  //     throw new UnauthorizedException('Невалидный refresh token');
  //   }

  //   const user = await this.userService.getById(payload.sub);

  //   if (!user) {
  //     throw new UnauthorizedException('Пользователь не найден');
  //   }

  //   const tokens = await this.issueTokens(user);

  //   return {
  //     user: this.toSafeUser(user),
  //     ...tokens,
  //   };
  // }

  verifyRefresh<T extends object = { sub: string }>(token: string): Promise<T> {
    return this.jwt.verifyAsync<T>(token, {
      secret: this.refreshSecret,
    });
  }

  public verifyAccess<T extends object = { sub: string }>(
    token: string,
  ): Promise<T> {
    return this.jwt.verifyAsync<T>(token, {
      secret: this.accessSecret,
    });
  }
  issueUserAccessToken(user: User) {
    return this.jwt.signAsync(
      {
        sub: user.id,
      },
      {
        secret: this.accessSecret,
        expiresIn: '15m',
      },
    );
  }

  issueRefreshToken(userId: string) {
    return this.jwt.signAsync(
      {
        sub: userId,
      },
      {
        secret: this.refreshSecret,
        expiresIn: '7d',
      },
    );
  }

  async issueTokens(user: User) {
    const accessToken = await this.issueUserAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
    };
  }

  async getNewTokens(refreshToken: string) {
    const payload = await this.verifyRefresh<{
      sub: string;
    }>(refreshToken);

    const user = await this.userService.getById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const tokens = await this.issueTokens(user);

    return {
      user,
      ...tokens,
    };
  }

  async validateOAuthLogin(
    req: Request | any,

    options?: {
      provider?: string;
      providerAccountId?: string | number;
    },
  ) {
    const oauthUser = (req as any).user ?? {};

    const provider = String(oauthUser.provider ?? options?.provider ?? 'oauth');

    const providerAccountId = String(
      oauthUser.providerAccountId ?? options?.providerAccountId ?? '',
    );

    let user = providerAccountId
      ? (
          await this.prismaService.account.findFirst({
            where: {
              provider,
              providerAccountId,
            },
            include: {
              user: true,
            },
          })
        )?.user ?? null
      : null;

    if (!user && oauthUser.email) {
      user = await this.prismaService.user.findFirst({
        where: {
          email: oauthUser.email,
        },
      });
    }

    if (!user) {
      user = await this.prismaService.user.create({
        data: {
          email: oauthUser.email ?? null,

          name: oauthUser.name ?? 'Не указано',

          image:
            oauthUser.picture ??
            oauthUser.avatar ??
            '/uploads/no-user-image.png',

          role: Role.Client,
        },
      });
    }

    if (provider && providerAccountId) {
      await this.prismaService.account.upsert({
        where: {
          provider_providerAccountId: {
            provider,
            providerAccountId,
          },
        },

        create: {
          provider,
          providerAccountId,
          type: 'oauth',
          userId: user.id,
        },

        update: {
          userId: user.id,
        },
      });
    }

    const tokens = await this.issueTokens(user);

    return {
      user: this.toSafeUser(user),
      ...tokens,
    };
  }

  addAccessTokenToResponse(response: ExpressResponse, token: string) {
    response.cookie(ACCESS_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
  }

  addRefreshTokenToResponse(response: ExpressResponse, token: string) {
    response.cookie(REFRESH_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  addGuestAccessTokenToResponse(response: ExpressResponse, token: string) {
    response.cookie(GUEST_ACCESS_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });
  }

  clearAccessToken(response: ExpressResponse) {
    response.clearCookie(ACCESS_TOKEN_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
    });
  }

  clearRefreshToken(response: ExpressResponse) {
    response.clearCookie(REFRESH_TOKEN_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
    });
  }

  clearGuestAccessToken(response: ExpressResponse) {
    response.clearCookie(GUEST_ACCESS_TOKEN_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
    });
  }

  clearAuthCookies(response: ExpressResponse) {
    this.clearAccessToken(response);
    this.clearRefreshToken(response);
    this.clearGuestAccessToken(response);
  }

  private async validateUser(dto: AuthDto): Promise<User> {
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

    return user;
  }

  private toSafeUser(user: User): SafeUser {
    const { password: _password, ...safeUser } = user;

    return safeUser;
  }

  public async getUserByAccessToken(accessToken: string): Promise<User> {
    try {
      const payload = await this.verifyAccess<{
        sub: string;
      }>(accessToken);

      return this.userService.getById(payload.sub);
    } catch {
      throw new UnauthorizedException('Access token недействителен или истёк');
    }
  }
}
