import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    if (err) return null;
    return user ?? null;
  }
}
