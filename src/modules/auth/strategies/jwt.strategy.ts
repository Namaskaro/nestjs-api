import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private readonly users: UserService) {
    super({
      secretOrKey: cfg.get<string>('JWT_SECRET'),
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) =>
          req?.cookies?.accessToken ?? req?.cookies?.access_token ?? null,
      ]),
    });
  }

  async validate(payload: any) {
    // Нет payload или нет id → считаем, что авторизации нет
    if (!payload || !payload.id) return null;

    const id = payload.sub;

    const user = await this.users.getById(id);
    return user ?? null;
  }
}
