import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { parse } from 'cookie';

import { AuthService } from '../auth.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    // ===== ИЗМЕНЕНО =====
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const client = context.switchToWs().getClient<Socket>();

    const cookies = parse(client.handshake.headers.cookie ?? '');
    const token = cookies.accessToken;

    if (!token) {
      throw new WsException('Unauthorized');
    }

    try {
      // ===== ИЗМЕНЕНО =====
      const payload = await this.authService.verifyAccess<{
        sub: string;
        role?: string;
      }>(token);

      client.data.user = {
        id: payload.sub,
        role: payload.role,
      };

      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
