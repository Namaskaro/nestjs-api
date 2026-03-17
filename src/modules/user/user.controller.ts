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
  BadRequestException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { Role, User } from '@/prisma/generated';
import { Roles } from '../auth/decorators/role.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async toggleFavorite(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
  ) {
    return this.userService.toggleFavorite(userId, productId);
  }

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
  @Patch('me/bio')
  async setUserBio(
    @CurrentUser('id') id: string,
    @Body() bioData: UpdateUserBioDto,
  ) {
    if (!id) {
      throw new BadRequestException('User ID is missing');
    }
    const user = await this.userService.setUserBio(id, bioData);
    const { password, createdAt, updatedAt, ...updatedUser } = user;
    return updatedUser;
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

    const updatedUser = await this.userService.changeAvatar(user, file);

    return {
      message: 'Аватар успешно обновлён',
      avatarUrl: updatedUser.image,
    };
  }
}
