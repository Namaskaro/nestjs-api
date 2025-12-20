import {
  Controller,
  HttpCode,
  Param,
  UseGuards,
  Get,
  Patch,
  Req,
  Body,
  Post,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { UserService } from './user.service';
import { Role, User } from '@/prisma/generated';
import { Roles } from '../auth/decorators/role.decorator';
import { JwtAuthGuard, OptionalJwtGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from './decorators/user.decorator';
import { Logger } from '@nestjs/common';
import { UpdateUserBioDto } from './dto/update-bio.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuthService,
  GUEST_ACCESS_TOKEN_NAME,
  REFRESH_TOKEN_NAME,
} from '../auth/auth.service';
const logger = new Logger('ProfileController');
import type { Request, Response } from 'express';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  @Get('profile')
  @UseGuards(OptionalJwtGuard)
  async getProfile(@CurrentUser('id') id: string) {
    return this.userService.getById(id);
  }

  @Get('search/:id')
  @HttpCode(200)
  // @Roles(Role.Admin)
  // @UseGuards(JwtAuthGuard, RolesGuard)
  async getUserById(@Param('id') id: string) {
    return this.userService.getById(id);
  }

  @Patch('/profile/favorites/:productId')
  @UseGuards(OptionalJwtGuard)
  async toggleFavorite(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
  ) {
    return this.userService.toggleFavorite(userId, productId);
  }
  // @UseGuards(JwtAuthGuard)
  // @Get('me')
  // getCurrentUser(@CurrentUser() user: User) {
  //   return user;
  // }

  @UseGuards(OptionalJwtGuard)
  @Get('me')
  async me(
    @CurrentUser() user: any,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    if (user) return user;

    const rt = req.cookies?.[REFRESH_TOKEN_NAME];
    if (rt) {
      try {
        const {
          user: u,
          accessToken,
          refreshToken,
        } = await this.authService.getNewTokens(rt);
        this.authService.addAccessTokenToResponse(res, accessToken);
        this.authService.addRefreshTokenToResponse(res, refreshToken);
        return u;
      } catch {}
    }

    const gAt = req.cookies?.[GUEST_ACCESS_TOKEN_NAME];
    if (gAt) {
      try {
        const payload: any = await this.authService.verifyAny(gAt);
        if (payload?.sub) return { id: payload.sub, isGuest: true };
      } catch {}
    }

    // нет юзера, нет refresh, нет гостя → создаём РАЗОВО
    const guest = await this.authService.createGuest();
    const gToken = await this.authService.issueGuestAccessToken(guest.id);
    this.authService.addGuestAccessTokenToResponse(res, gToken);
    return { id: guest.id, isGuest: true };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/bio')
  async setUserBio(@Param('id') id: string, @Body() bioData: UpdateUserBioDto) {
    const user = await this.userService.setUserBio(id, bioData);
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @Post('avatar/change')
  @UseInterceptors(FileInterceptor('file'))
  async changeAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any, // обычно req.user подставляется guard-ом
  ) {
    const user = req.user;

    if (!file) {
      return {
        message: 'Файл не загружен',
        statusCode: HttpStatus.BAD_REQUEST,
      };
    }

    await this.userService.changeAvatar(user, file);

    return {
      message: 'Аватар успешно обновлён',
      avatarUrl: `/avatars/${user.id}.webp`,
    };
  }
}
