import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';

import type { Request, Response } from 'express';

import { AuthDto } from '../user/dto/auth.dto';

import { AuthService, REFRESH_TOKEN_NAME } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(200)
  async register(@Body() dto: AuthDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: AuthDto,

    @Res({ passthrough: true })
    response: Response,
  ) {
    const result = await this.authService.login(dto);

    this.authService.clearGuestAccessToken(response);

    this.authService.addAccessTokenToResponse(response, result.accessToken);

    this.authService.addRefreshTokenToResponse(response, result.refreshToken);

    return {
      user: result.user,
    };
  }

  @Post('login/access-token')
  @HttpCode(200)
  async getNewTokens(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[REFRESH_TOKEN_NAME];

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token отсутствует');
    }

    const tokens = await this.authService.getNewTokens(refreshToken);

    this.authService.addAccessTokenToResponse(response, tokens.accessToken);

    this.authService.addRefreshTokenToResponse(response, tokens.refreshToken);

    return tokens.user;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Res({ passthrough: true })
    response: Response,
  ) {
    this.authService.clearAuthCookies(response);

    return {
      success: true,
    };
  }
}
