import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';

import { UserService } from './user.service';
import { CurrentUser } from './decorators/user.decorator';
import { UpdateUserBioDto } from './dto/update-bio.dto';
import { User } from '@/prisma/generated';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  // @Get('me')
  // @UseGuards(JwtAuthGuard)
  // async getCurrentUser(@CurrentUser() user: User) {
  //   return user;
  // }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@CurrentUser('id') userId: string) {
    return this.authService.getCurrentUser(userId);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('id') userId: string) {
    return this.userService.getById(userId);
  }

  @Get('search/:id')
  @HttpCode(200)
  async getUserById(@Param('id') id: string) {
    return this.userService.getById(id);
  }

  @Patch('profile/favorites/:productId')
  @UseGuards(JwtAuthGuard)
  async toggleFavorite(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
  ) {
    return this.userService.toggleFavorite(userId, productId);
  }

  @Patch('me/bio')
  @UseGuards(JwtAuthGuard)
  async setUserBio(
    @CurrentUser('id') userId: string,
    @Body() bioData: UpdateUserBioDto,
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is missing');
    }

    return this.userService.setUserBio(userId, bioData);
  }

  @Post('avatar/change')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async changeAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    const updatedUser = await this.userService.changeAvatar(user, file);

    return {
      message: 'Аватар успешно обновлён',
      avatarUrl: updatedUser.image,
    };
  }
}
