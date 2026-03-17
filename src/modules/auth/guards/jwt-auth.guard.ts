import { PrismaService } from '@/src/core/prisma/prisma.service';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
export class JwtAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<any>();
    const res = ctx.switchToHttp().getResponse<ExpressResponse>();

    let accessToken: string | null = null;
    const h = req.headers['authorization'];
    if (h?.startsWith('Bearer ')) accessToken = h.slice(7);
    if (!accessToken) accessToken = req.cookies?.[ACCESS_TOKEN_NAME] ?? null;
    if (!accessToken)
      accessToken = req.cookies?.[GUEST_ACCESS_TOKEN_NAME] ?? null;

    const refreshToken = req.cookies?.[REFRESH_TOKEN_NAME] ?? null;

    try {
      // 1️⃣ Проверяем access токен
      if (accessToken) {
        const payload: any = await this.auth.verifyAccess(accessToken);

        // Если не гость
        if (!payload.isGuest) {
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });
          if (!user) return false;
          req.user = user;
          return true;
        }

        // Guest + есть refresh → апгрейд
        if (payload.isGuest && refreshToken) {
          const {
            user,
            accessToken: newAccess,
            refreshToken: newRefresh,
          } = await this.auth.getNewTokens(refreshToken);
          this.auth.clearAccessTokens(res);
          this.auth.addAccessTokenToResponse(res, newAccess);
          this.auth.addRefreshTokenToResponse(res, newRefresh);
          req.user = user;
          return true;
        }

        // Guest без refresh
        req.user = { isGuest: true };
        return true;
      }

      // 2️⃣ Если access токена нет, но есть refresh
      if (refreshToken) {
        const {
          user,
          accessToken: newAccess,
          refreshToken: newRefresh,
        } = await this.auth.getNewTokens(refreshToken);
        this.auth.clearAccessTokens(res);
        this.auth.addAccessTokenToResponse(res, newAccess);
        this.auth.addRefreshTokenToResponse(res, newRefresh);
        req.user = user;
        return true;
      }

      // 3️⃣ Нет токенов
      return false;
    } catch (e) {
      // Любая ошибка — проверяем refresh
      if (refreshToken) {
        try {
          const {
            user,
            accessToken: newAccess,
            refreshToken: newRefresh,
          } = await this.auth.getNewTokens(refreshToken);
          this.auth.clearAccessTokens(res);
          this.auth.addAccessTokenToResponse(res, newAccess);
          this.auth.addRefreshTokenToResponse(res, newRefresh);
          req.user = user;
          return true;
        } catch (e2) {
          return false; // refresh тоже невалиден
        }
      }
      return false; // ни access, ни refresh невалидны
    }
  }
}
