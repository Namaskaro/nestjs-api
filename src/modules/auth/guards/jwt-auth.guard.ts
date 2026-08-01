// import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
// import { ACCESS_TOKEN_NAME, AuthService } from '../auth.service';

// import { UserService } from '../../user/user.service';

// @Injectable()
// export class JwtAuthGuard implements CanActivate {
//   constructor(
//     private readonly auth: AuthService, // private readonly userService: UserService,
//   ) {}

//   async canActivate(ctx: ExecutionContext): Promise<boolean> {
//     const req = ctx.switchToHttp().getRequest<any>();

//     const accessToken = this.extractAccessToken(req);

//     if (!accessToken) {
//       return false;
//     }

//     try {
//       const payload = await this.auth.verifyAccess(accessToken);
//       req.user = payload;
//       return true;
//     } catch {
//       return false;
//     }
//   }

//   private extractAccessToken(req: any): string | null {
//     const authHeader = req.headers.authorization;

//     if (authHeader?.startsWith('Bearer ')) {
//       return authHeader.slice(7);
//     }

//     return req.cookies?.[ACCESS_TOKEN_NAME] ?? null;
//   }
// }

// import {
//   CanActivate,
//   ExecutionContext,
//   Injectable,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { ACCESS_TOKEN_NAME, AuthService } from '../auth.service';

// @Injectable()
// export class JwtAuthGuard implements CanActivate {
//   constructor(private readonly authService: AuthService) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();

//     const accessToken = this.extractAccessToken(request);

//     if (!accessToken) {
//       throw new UnauthorizedException('Access token отсутствует');
//     }

//     try {
//       const payload = await this.authService.verifyAccess<{
//         sub: string;
//       }>(accessToken);

//       request.user = payload;

//       return true;
//     } catch {
//       throw new UnauthorizedException('Access token недействителен или истёк');
//     }
//   }

//   private extractAccessToken(request: any): string | null {
//     const authHeader = request.headers.authorization;

//     if (authHeader?.startsWith('Bearer ')) {
//       return authHeader.slice(7);
//     }

//     return request.cookies?.[ACCESS_TOKEN_NAME] ?? null;
//   }
// }

// import {
//   CanActivate,
//   ExecutionContext,
//   Injectable,
//   UnauthorizedException,
// } from '@nestjs/common';

// import { ACCESS_TOKEN_NAME, AuthService } from '../auth.service';

// interface AccessTokenPayload {
//   sub: string;
//   iat?: number;
//   exp?: number;
// }

// @Injectable()
// export class JwtAuthGuard implements CanActivate {
//   constructor(private readonly authService: AuthService) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();

//     const accessToken = request.cookies?.[ACCESS_TOKEN_NAME];

//     if (!accessToken) {
//       throw new UnauthorizedException('Access token отсутствует');
//     }

//     try {
//       const payload = await this.authService.verifyAccess<AccessTokenPayload>(
//         accessToken,
//       );

//       if (!payload.sub) {
//         throw new UnauthorizedException('Некорректный access token');
//       }

//       request.user = payload;

//       return true;
//     } catch {
//       throw new UnauthorizedException('Access token недействителен или истёк');
//     }
//   }
// }

// import {
//   CanActivate,
//   ExecutionContext,
//   Injectable,
//   UnauthorizedException,
// } from '@nestjs/common';

// import { ACCESS_TOKEN_NAME, AuthService } from '../auth.service';
// import { UserService } from '../../user/user.service';

// @Injectable()
// export class JwtAuthGuard implements CanActivate {
//   constructor(
//     private readonly authService: AuthService,
//     private readonly userService: UserService,
//   ) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();

//     const accessToken = request.cookies?.[ACCESS_TOKEN_NAME];

//     if (!accessToken) {
//       throw new UnauthorizedException('Access token отсутствует');
//     }

//     try {
//       const payload = await this.authService.verifyAccess<{
//         sub: string;
//       }>(accessToken);

//       const user = await this.userService.getById(payload.sub);

//       if (!user) {
//         throw new UnauthorizedException('Пользователь не найден');
//       }

//       request.user = user;

//       return true;
//     } catch {
//       throw new UnauthorizedException('Access token недействителен или истёк');
//     }
//   }
// }

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { ACCESS_TOKEN_NAME, AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const accessToken = request.cookies?.[ACCESS_TOKEN_NAME];

    if (!accessToken) {
      throw new UnauthorizedException('Access token отсутствует');
    }

    request.user = await this.authService.getUserByAccessToken(accessToken);

    return true;
  }
}
