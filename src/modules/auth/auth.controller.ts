// /* eslint-disable @typescript-eslint/no-unused-vars */
// /* eslint-disable @typescript-eslint/no-empty-function */
// import {
//   Body,
//   Controller,
//   Get,
//   HttpCode,
//   Post,
//   Req,
//   Res,
//   UnauthorizedException,
//   UsePipes,
//   ValidationPipe,
//   SetMetadata,
// } from '@nestjs/common';
// import { AuthService, REFRESH_TOKEN_NAME } from './auth.service';
// import { AuthDto } from '../user/dto/auth.dto';
// import { Request, Response } from 'express';
// import { ConfigService } from '@nestjs/config';
// import { ChatService } from '../chat/chat.service';
// import { ActivateOperatotDto } from './dto/activate-operator.dto';

// export const Public = () => SetMetadata('isPublic', true);

// @Controller('auth')
// export class AuthController {
//   constructor(
//     private readonly authService: AuthService,
//     private readonly config: ConfigService,
//     private readonly chatService: ChatService,
//   ) {}

//   @UsePipes(new ValidationPipe())
//   @HttpCode(200)
//   @Post('login')
//   async login(@Body() dto: AuthDto, @Res({ passthrough: true }) res: Response) {
//     const result = await this.authService.login(dto);
//     if (result) {
//       this.authService.addAccessTokenToResponse(res, result.accessToken);
//       this.authService.addRefreshTokenToResponse(res, result.refreshToken);
//     }

//     return result;
//   }

//   @Get('check')
//   async checkSession(@Req() req: Request) {
//     if (!req.session.guestId) {
//       req.session.guestId = `guest_${Date.now()}`;

//       // Обязательно сохраняем сессию в Redis
//       await new Promise<void>((resolve, reject) => {
//         req.session.save((err) => {
//           if (err) return reject(err);
//           resolve();
//         });
//       });
//     }

//     return {
//       guestId: req.session.guestId,
//       cookieExpires: req.session.cookie.expires,
//     };
//   }

//   @UsePipes(new ValidationPipe())
//   @HttpCode(200)
//   @Post('register')
//   async register(
//     @Body() dto: AuthDto,
//     @Res({ passthrough: true }) res: Response,
//   ) {
//     const { refreshToken, ...response } = await this.authService.register(dto);
//     this.authService.addAccessTokenToResponse(res, response.accessToken);
//     this.authService.addRefreshTokenToResponse(res, refreshToken);
//     return response;
//   }

//   @UsePipes(new ValidationPipe())
//   @HttpCode(200)
//   @Post('login/access-token')
//   async getNewTokens(
//     @Req() req: Request,
//     @Res({ passthrough: true }) res: Response,
//   ) {
//     const refreshTokenFromCookies = req.cookies[REFRESH_TOKEN_NAME];
//     if (!refreshTokenFromCookies) {
//       this.authService.clearAccessTokens(res);
//       throw new UnauthorizedException('Refresh token не прошел');
//     }
//     const { refreshToken, ...response } = await this.authService.getNewTokens(
//       refreshTokenFromCookies,
//     );
//     this.authService.addAccessTokenToResponse(res, response.accessToken);
//     this.authService.addRefreshTokenToResponse(res, refreshToken);
//     return response;
//   }

//   // @HttpCode(200)
//   // @Post('logout')
//   // async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
//   //   this.authService.removeRefreshTokenFromResponse(res);
//   //   return true;
//   // }

//   @Post('logout')
//   @HttpCode(200)
//   async logout(@Res({ passthrough: true }) res: Response) {
//     this.authService.clearAccessTokens(res);
//     this.authService.clearRefreshToken(res);
//     return true;
//   }

//   // @Public()
//   // @Get('yandex')
//   // @UseGuards(AuthGuard('yandex'))
//   // async yandexAuth(@Req() req) {}

//   // @Public()
//   // @Get('yandex/callback')
//   // @UseGuards(AuthGuard('yandex'))
//   // async yandexCallback(
//   //   @Req() req: any,
//   //   @Res({ passthrough: true }) res: Response,
//   // ) {
//   //   const { accessToken, refreshToken } =
//   //     await this.authService.validate0AuthLogin(req, {
//   //       provider: 'yandex',
//   //       providerAccountId: req?.user?.id,
//   //     });
//   //   this.authService.clearAccessTokens(res);
//   //   this.authService.addAccessTokenToResponse(res, accessToken);
//   //   this.authService.addRefreshTokenToResponse(res, refreshToken);
//   //   return res.redirect(process.env['CLIENT_URL']);
//   // }

//   // ---------- VK ----------
//   // @Get('vk')
//   // @UseGuards(AuthGuard('vkontakte'))
//   // async vkAuth() {
//   //   // passport сделает redirect
//   // }

//   // @Get('vk/callback')
//   // @UseGuards(AuthGuard('vkontakte'))
//   // async vkCallback(
//   //   @Req() req: Request,
//   //   @Res({ passthrough: true }) res: Response,
//   // ) {
//   //   // const { refreshToken, ...response } =
//   //   //   await this.authService.validate0AuthLogin(req, {
//   //   //     provider: 'vk',
//   //   //     providerAccountId: (req as any)?.user?.providerAccountId,
//   //   //   });
//   //   // this.authService.addRefreshTokenToResponse(res, refreshToken);
//   //   // this.authService.addAccessTokenToResponse(res, accessToken);
//   //   // return res.redirect(
//   //   //   `${process.env['CLIENT_URL']}/?accessToken=${response.accessToken}`,
//   //   // );
//   //   const { refreshToken, accessToken } =
//   //     await this.authService.validate0AuthLogin(req, {
//   //       provider: 'yandex',
//   //       providerAccountId: (req as any)?.user?.id ?? undefined,
//   //     });

//   //   this.authService.addRefreshTokenToResponse(res, refreshToken);
//   //   this.authService.addAccessTokenToResponse(res, accessToken); // 👈 Новый шаг

//   //   // редиректим без query-парам — токены уже в куках
//   //   return res.redirect(process.env['CLIENT_URL']);
//   // }

//   @Post('/operator/invite')
//   async inviteOperator(@Body() email: string) {
//     await this.chatService.inviteOperator(email);

//     return {
//       message: `Писььмо с приглашением отправлено на email ${email}`,
//     };
//   }

//   @Post('/operator/invite/activate')
//   async activateOperator(@Body() activateDto: ActivateOperatotDto) {
//     return await this.chatService.activateOperator(
//       activateDto.token,
//       activateDto.passwordHashed,
//       activateDto.name,
//     );
//   }
// }

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

  // @Post('login/access-token')
  // @HttpCode(200)
  // async refreshTokens(
  //   @Req() request: Request,

  //   @Res({ passthrough: true })
  //   response: Response,
  // ) {
  //   const refreshToken = request.cookies?.[REFRESH_TOKEN_NAME];

  //   if (!refreshToken) {
  //     throw new UnauthorizedException('Refresh token отсутствует');
  //   }

  //   const result = await this.authService.getNewTokens(refreshToken);

  //   this.authService.addAccessTokenToResponse(response, result.accessToken);

  //   this.authService.addRefreshTokenToResponse(response, result.refreshToken);

  //   return {
  //     user: result.user,
  //   };
  // }

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
