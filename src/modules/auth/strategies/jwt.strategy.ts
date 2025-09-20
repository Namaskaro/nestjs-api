// import { Injectable, UnauthorizedException } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { PassportStrategy } from '@nestjs/passport';
// import { ExtractJwt, Strategy } from 'passport-jwt';
// import { UserService } from '../../user/user.service';
// import { Logger } from '@nestjs/common';

// const logger = new Logger('JwtStrategy');

// @Injectable()
// export class JwtStrategy extends PassportStrategy(Strategy) {
//   public constructor(
//     private readonly configService: ConfigService,
//     private readonly userService: UserService,
//   ) {
//     super({
//       jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
//       ignoreExpiration: false,
//       secretOrKey: configService.get('JWT_SECRET'),
//     });
//   }

//   async validate({ id }: { id: string }) {
//     console.log('🛂 JWT id:', id); // ← ты это должен видеть
//     const user = await this.userService.getById(id);
//     console.log('📦 Найден пользователь:', user);
//     if (!user) {
//       throw new UnauthorizedException();
//     }

//     // return user;
//     return {
//       id: user.id,
//       email: user.email,
//       role: user.role,
//     };
//   }
// }

// auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';

type JwtPayload = { sub: string; isGuest?: boolean };

// @Injectable()
// export class JwtStrategy extends PassportStrategy(Strategy) {
//   constructor(cfg: ConfigService, private readonly users: UserService) {
//     super({
//       secretOrKey: cfg.get<string>('JWT_SECRET'),
//       jwtFromRequest: ExtractJwt.fromExtractors([
//         ExtractJwt.fromAuthHeaderAsBearerToken(),
//         (req) =>
//           req?.cookies?.access_token ?? req?.cookies?.guest_token ?? null, // если решишь класть в cookie
//       ]),
//     });
//   }

//   async validate(payload: any) {
//     if (payload?.isGuest) {
//       // гость — можно не ходить в БД
//       return { id: payload.id, isGuest: true };
//     }
//     const user = await this.users.getById(payload.id);
//     return user ? { ...user, isGuest: false } : null;
//   }
// }

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private readonly users: UserService) {
    super({
      secretOrKey: cfg.get<string>('JWT_SECRET'),
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) =>
          // 👇 добавили чтение accessToken (именно так cookie называется у фронта)
          req?.cookies?.accessToken ??
          req?.cookies?.access_token ??
          req?.cookies?.guest_token ??
          null,
      ]),
    });
  }

  async validate(payload: any) {
    // Нет payload или нет id → считаем, что авторизации нет
    if (!payload || !payload.id) return null;

    // Ветка гостя: мог быть удалён по TTL → проверим, что ещё существует
    if (payload.isGuest) {
      try {
        const guest = await this.users.getById(payload.id);
        if (guest && (guest as any).isGuest) {
          return { id: guest.id, isGuest: true };
        }
      } catch {}
      // Гость не найден → авторизации нет
      return null;
    }

    // Ветка обычного пользователя
    const user = await this.users.getById(payload.id);
    return user ? { ...user, isGuest: false } : null;
  }
}
