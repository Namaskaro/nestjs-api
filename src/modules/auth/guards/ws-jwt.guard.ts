
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { parse } from 'cookie';
import { AuthService } from '../auth.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const client = context.switchToWs().getClient<Socket>();
    const token = parse(client.handshake.headers.cookie ?? '').accessToken;
    if (!token) throw new WsException('Unauthorized');

    try {
      client.data.user = await this.authService.getSocketIdentity(token);
      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
