import { PrismaService } from '@/src/core/prisma/prisma.service';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import {
  ACCESS_TOKEN_NAME,
  AuthService,
  GUEST_ACCESS_TOKEN_NAME,
  REFRESH_TOKEN_NAME,
} from '../auth.service';
import type { Response as ExpressResponse } from 'express';
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// export class OptionalJwtGuard extends AuthGuard('jwt') {
//   handleRequest(err: any, user: any) {
//     if (err) return null;
//     return user ?? null;
//   }
// }

@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<any>();
    const res = ctx.switchToHttp().getResponse<ExpressResponse>();

    let token: string | null = null;
    const h = req.headers['authorization'];
    if (h?.startsWith('Bearer ')) token = h.slice(7);
    if (!token) token = req.cookies?.[ACCESS_TOKEN_NAME] ?? null;
    if (!token) token = req.cookies?.[GUEST_ACCESS_TOKEN_NAME] ?? null;

    const refresh = req.cookies?.[REFRESH_TOKEN_NAME] ?? null;

    // ⚠️ Диагностика
    if (token) {
      try {
        const payload: any = await this.auth.verifyAccess(token);
        // guest → попробовать апгрейд по refresh
        if (payload.isGuest && refresh) {
          const { user, accessToken, refreshToken } =
            await this.auth.getNewTokens(refresh);
          this.auth.clearAccessTokens(res);
          this.auth.addAccessTokenToResponse(res, accessToken);
          this.auth.addRefreshTokenToResponse(res, refreshToken);
          req.user = user;
          console.log('[guard] upgraded guest to user:', user?.id);
          return true;
        }

        if (!payload.isGuest) {
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });
          if (user) {
            req.user = user;
            console.log('[guard] user set:', user.id);
          } else {
            console.log('[guard] user not found by id:', payload.sub);
          }
          return true;
        }

        // гость без refresh — не трогаем
        console.log('[guard] guest token present');
        return true;
      } catch (e) {
        // access битый — пробуем refresh
        if (refresh) {
          try {
            const { user, accessToken, refreshToken } =
              await this.auth.getNewTokens(refresh);
            this.auth.clearAccessTokens(res);
            this.auth.addAccessTokenToResponse(res, accessToken);
            this.auth.addRefreshTokenToResponse(res, refreshToken);
            req.user = user;
            console.log('[guard] recovered from refresh:', user?.id);
          } catch (e2) {
            console.log('[guard] refresh failed');
          }
        } else {
          console.log('[guard] verify failed, no refresh');
        }
        return true;
      }
    }

    // нет токенов
    console.log('[guard] no tokens');
    return true;
  }
}
