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
  SetMetadata,
} from '@nestjs/common';
import { AuthService, REFRESH_TOKEN_NAME } from './auth.service';
import { AuthDto } from '../user/dto/auth.dto';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from '../user/user.service';
import { ConfigService } from '@nestjs/config';

export const Public = () => SetMetadata('isPublic', true);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // 3) Создание гостя (возвращаем только { id, name })
  @Post('guest')
  @HttpCode(HttpStatus.CREATED)
  create() {
    return this.authService.createGuest();
  }

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
    const refreshTokenFromCookies = req.cookies[REFRESH_TOKEN_NAME];
    if (!refreshTokenFromCookies) {
      this.authService.clearAccessTokens(res);
      throw new UnauthorizedException('Refresh token не прошел');
    }
    const { refreshToken, ...response } = await this.authService.getNewTokens(
      refreshTokenFromCookies,
    );
    this.authService.addRefreshTokenToResponse(res, refreshToken);
    return response;
  }

  // @HttpCode(200)
  // @Post('logout')
  // async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  //   this.authService.removeRefreshTokenFromResponse(res);
  //   return true;
  // }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAccessTokens(res);
    return true;
  }

  @Public()
  @Get('yandex')
  @UseGuards(AuthGuard('yandex'))
  async yandexAuth(@Req() req) {}

  @Public()
  @Get('yandex/callback')
  @UseGuards(AuthGuard('yandex'))
  async yandexCallback(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } =
      await this.authService.validate0AuthLogin(req, {
        provider: 'yandex',
        providerAccountId: req?.user?.id,
      });
    this.authService.clearAccessTokens(res);
    this.authService.addAccessTokenToResponse(res, accessToken);
    this.authService.addRefreshTokenToResponse(res, refreshToken);
    return res.redirect(process.env['CLIENT_URL']);
  }

  // ---------- VK ----------
  @Get('vk')
  @UseGuards(AuthGuard('vkontakte'))
  async vkAuth() {
    // passport сделает redirect
  }

  @Get('vk/callback')
  @UseGuards(AuthGuard('vkontakte'))
  async vkCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // const { refreshToken, ...response } =
    //   await this.authService.validate0AuthLogin(req, {
    //     provider: 'vk',
    //     providerAccountId: (req as any)?.user?.providerAccountId,
    //   });
    // this.authService.addRefreshTokenToResponse(res, refreshToken);
    // this.authService.addAccessTokenToResponse(res, accessToken);
    // return res.redirect(
    //   `${process.env['CLIENT_URL']}/?accessToken=${response.accessToken}`,
    // );
    const { refreshToken, accessToken } =
      await this.authService.validate0AuthLogin(req, {
        provider: 'yandex',
        providerAccountId: (req as any)?.user?.id ?? undefined,
      });

    this.authService.addRefreshTokenToResponse(res, refreshToken);
    this.authService.addAccessTokenToResponse(res, accessToken); // 👈 Новый шаг

    // редиректим без query-парам — токены уже в куках
    return res.redirect(process.env['CLIENT_URL']);
  }

  // 2) Получить гостя (для самовосстановления на фронте)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.authService.getGuest(id);
  }
}
