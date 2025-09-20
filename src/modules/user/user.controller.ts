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
import { AuthService } from '../auth/auth.service';
const logger = new Logger('ProfileController');

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
  @UseGuards(JwtAuthGuard)
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
  async getCurrentUser(
    @CurrentUser() user: User | { id: string; isGuest: true } | null,
  ) {
    if (user) {
      // обычный пользователь (isGuest=false) или гость (isGuest=true) уже в токене
      return user;
    }

    // нет токена → создаём гостя + выдаём гостевой access-токен
    const guest = await this.authService.createGuest(); // у тебя уже есть этот метод
    const accessToken = this.authService.issueGuestAccessToken(guest.id);

    // Вернём в body — фронт положит в Authorization: Bearer ...
    return { id: guest.id, isGuest: true, accessToken };
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
