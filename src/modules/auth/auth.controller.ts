/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-empty-function */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Headers,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDto } from '../user/dto/auth.dto';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from '../user/user.service';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly users: UserService,
    private readonly cfg: ConfigService,
  ) {}

  // 3) Создание гостя (возвращаем только { id, name })
  @Post('guest')
  @HttpCode(HttpStatus.CREATED)
  create() {
    return this.authService.createGuest();
  }

  // 2) Получить гостя (для самовосстановления на фронте)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.authService.getGuest(id);
  }

  // @HttpCode(200)
  // @Post('external/mint')
  // async mintForExternal(
  //   @Headers('x-internal-secret') secret: string,
  //   @Body() body: { userId: string },
  //   @Res({ passthrough: true }) res: Response,
  // ) {
  //   if (secret !== this.cfg.get<string>('INTERNAL_SYNC_SECRET')) {
  //     throw new UnauthorizedException('forbidden');
  //   }
  //   const user = await this.users.getById(body.userId);
  //   if (!user || user.isGuest)
  //     throw new UnauthorizedException('user not found');

  //   const { accessToken, refreshToken } = this.authService.issueTokens(user.id);
  //   // опционально кладём refresh cookie (как в login/register)
  //   this.authService.addRefreshTokenToResponse(res, refreshToken);

  //   return {
  //     accessToken,
  //     user: {
  //       id: user.id,
  //       email: user.email,
  //       name: user.name,
  //       role: user.role,
  //       image: user.image,
  //     },
  //   };
  // }

  // 5) Пинг для продления TTL
  @Post('ping')
  @HttpCode(HttpStatus.NO_CONTENT) // фронту ответ не нужен
  async ping(@Req() req: Request, @Body('id') id?: string) {
    // поддержка как urlencoded, так и text/plain (sendBeacon может прислать text/plain)
    if (!id && typeof req.body === 'string') {
      try {
        const params = new URLSearchParams(req.body);
        id = params.get('id') ?? undefined;
      } catch {
        // игнорируем
      }
    }
    if (id) {
      await this.authService.ping(id);
    }
    // 204 без ошибок даже если id некорректный/несуществующий — фронт всё равно не читает
  }

  @UsePipes(new ValidationPipe())
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: AuthDto, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...response } = await this.authService.login(dto);

    this.authService.addRefreshTokenToResponse(res, refreshToken);
    return response;
  }

  @UsePipes(new ValidationPipe())
  @HttpCode(200)
  @Post('register')
  async register(
    @Body() dto: AuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...response } = await this.authService.register(dto);

    this.authService.addRefreshTokenToResponse(res, refreshToken);
    return response;
  }

  @UsePipes(new ValidationPipe())
  @HttpCode(200)
  @Post('login/access-token')
  async getNewTokens(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenFromCookies =
      req.cookies[this.authService.REFRESH_TOKEN_NAME];
    if (!refreshTokenFromCookies) {
      this.authService.removeRefreshTokenFromResponse(res);
      throw new UnauthorizedException('Refresh token не прошел');
    }
    const { refreshToken, ...response } = await this.authService.getNewTokens(
      refreshTokenFromCookies,
    );
    this.authService.addRefreshTokenToResponse(res, refreshToken);
    return response;
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.authService.removeRefreshTokenFromResponse(res);
    return true;
  }

  @Get('google')
  // @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {}

  @Get('google/callback')
  // @UseGuards(AuthGuard('google'))
  async googleAuthCallback(
    @Req() req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...response } =
      await this.authService.validate0AuthLogin(req);

    this.authService.addRefreshTokenToResponse(res, refreshToken);
    console.log(response);
    return res.redirect(
      `${process.env['CLIENT_URL']}/?accessToken=${response.accessToken}`,
    );
  }

  @Get('yandex')
  @UseGuards(AuthGuard('yandex'))
  async yandexAuth(@Req() req) {}

  @Get('yandex/callback')
  // @UseGuards(AuthGuard('yandex'))
  async yandexAuthCallback(
    @Req() req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...response } =
      await this.authService.validate0AuthLogin(req);

    this.authService.addRefreshTokenToResponse(res, refreshToken);

    console.log(refreshToken);

    return res.redirect(
      `${process.env['CLIENT_URL']}/?accessToken=${response.accessToken}`,
    );
  }
}
