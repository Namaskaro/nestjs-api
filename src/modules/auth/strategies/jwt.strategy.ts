import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../../user/user.service';
import { Logger } from '@nestjs/common';

const logger = new Logger('JwtStrategy');

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  public constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate({ id }: { id: string }) {
    console.log('🛂 JWT id:', id); // ← ты это должен видеть
    const user = await this.userService.getById(id);
    console.log('📦 Найден пользователь:', user);
    if (!user) {
      throw new UnauthorizedException();
    }

    // return user;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
