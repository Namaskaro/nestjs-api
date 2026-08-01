// import {
//   Controller,
//   HttpCode,
//   Param,
//   UseGuards,
//   Get,
//   Patch,
//   Req,
//   Body,
//   Post,
//   UploadedFile,
//   UseInterceptors,
//   HttpStatus,
//   Res,
//   BadRequestException,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { UserService } from './user.service';
// import { Role, User } from '@/prisma/generated';
// import { Roles } from '../auth/decorators/role.decorator';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RolesGuard } from '../auth/guards/roles.guard';
// import { Auth } from '../auth/decorators/auth.decorator';
// import { CurrentUser } from './decorators/user.decorator';
// import { Logger } from '@nestjs/common';
// import { UpdateUserBioDto } from './dto/update-bio.dto';
// import { FileInterceptor } from '@nestjs/platform-express';
// import { AuthService, REFRESH_TOKEN_NAME } from '../auth/auth.service';
// const logger = new Logger('ProfileController');
// import type { Request, Response } from 'express';

// @Controller('user')
// export class UserController {
//   constructor(
//     private readonly userService: UserService,
//     private readonly authService: AuthService,
//   ) {}

//   @Get('profile')
//   @UseGuards(JwtAuthGuard)
//   async getProfile(@CurrentUser('id') id: string) {
//     return this.userService.getById(id);
//   }

//   @Get('search/:id')
//   @HttpCode(200)
//   async getUserById(@Param('id') id: string) {
//     return this.userService.getById(id);
//   }

//   @Patch('/profile/favorites/:productId')
//   @UseGuards(JwtAuthGuard)
//   async toggleFavorite(
//     @CurrentUser('id') userId: string,
//     @Param('productId') productId: string,
//   ) {
//     return this.userService.toggleFavorite(userId, productId);
//   }

//   @Get('me')
//   async me(@CurrentUser() user: any) {
//     return user;
//   }

//   @Post('refresh')
//   async refresh(@Req() req, @Res({ passthrough: true }) res) {
//     const rt = req.cookies?.[REFRESH_TOKEN_NAME];

//     if (!rt) {
//       throw new UnauthorizedException();
//     }

//     const tokens = await this.authService.getNewTokens(rt);

//     this.authService.addAccessTokenToResponse(res, tokens.accessToken);

//     this.authService.addRefreshTokenToResponse(res, tokens.refreshToken);

//     return tokens.user;
//   }

//   @UseGuards(JwtAuthGuard)
//   @Patch('me/bio')
//   async setUserBio(
//     @CurrentUser('id') id: string,
//     @Body() bioData: UpdateUserBioDto,
//   ) {
//     if (!id) {
//       throw new BadRequestException('User ID is missing');
//     }
//     const user = await this.userService.setUserBio(id, bioData);

//     return user;
//   }

//   @UseGuards(JwtAuthGuard)
//   @Post('avatar/change')
//   @UseInterceptors(FileInterceptor('file'))
//   async changeAvatar(
//     @UploadedFile() file: Express.Multer.File,
//     @Req() req: any, // обычно req.user подставляется guard-ом
//   ) {
//     const user = req.user;

//     if (!file) {
//       return {
//         message: 'Файл не загружен',
//         statusCode: HttpStatus.BAD_REQUEST,
//       };
//     }

//     const updatedUser = await this.userService.changeAvatar(user, file);

//     return {
//       message: 'Аватар успешно обновлён',
//       avatarUrl: updatedUser.image,
//     };
//   }
// }

// import {
//   BadRequestException,
//   Body,
//   Controller,
//   Get,
//   HttpCode,
//   HttpStatus,
//   Param,
//   Patch,
//   Post,
//   UploadedFile,
//   UseGuards,
//   UseInterceptors,
// } from '@nestjs/common';

// import { FileInterceptor } from '@nestjs/platform-express';

// import { UserService } from './user.service';

// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { AuthService } from '../auth/auth.service';

// import { CurrentUser } from './decorators/user.decorator';

// import { UpdateUserBioDto } from './dto/update-bio.dto';

// @Controller('user')
// export class UserController {
//   constructor(
//     private readonly userService: UserService,

//     private readonly authService: AuthService,
//   ) {}

//   @Get('me')
//   @UseGuards(JwtAuthGuard)
//   async getCurrentUser(
//     @CurrentUser('sub')
//     userId: string,
//   ) {
//     return this.authService.getCurrentUser(userId);
//   }

//   @Get('profile')
//   @UseGuards(JwtAuthGuard)
//   async getProfile(
//     @CurrentUser('sub')
//     userId: string,
//   ) {
//     return this.userService.getById(userId);
//   }

//   @Get('search/:id')
//   @HttpCode(200)
//   async getUserById(@Param('id') id: string) {
//     return this.userService.getById(id);
//   }

//   @Patch('profile/favorites/:productId')
//   @UseGuards(JwtAuthGuard)
//   async toggleFavorite(
//     @CurrentUser('sub')
//     userId: string,

//     @Param('productId')
//     productId: string,
//   ) {
//     return this.userService.toggleFavorite(userId, productId);
//   }

//   @Patch('me/bio')
//   @UseGuards(JwtAuthGuard)
//   async setUserBio(
//     @CurrentUser('sub')
//     userId: string,

//     @Body()
//     bioData: UpdateUserBioDto,
//   ) {
//     if (!userId) {
//       throw new BadRequestException('User ID is missing');
//     }

//     return this.userService.setUserBio(userId, bioData);
//   }

//   @Post('avatar/change')
//   @UseGuards(JwtAuthGuard)
//   @UseInterceptors(FileInterceptor('file'))
//   async changeAvatar(
//     @UploadedFile()
//     file: Express.Multer.File,

//     @CurrentUser('sub')
//     userId: string,
//   ) {
//     if (!file) {
//       return {
//         message: 'Файл не загружен',

//         statusCode: HttpStatus.BAD_REQUEST,
//       };
//     }

//     const updatedUser = await this.userService.changeAvatar(userId, file);

//     return {
//       message: 'Аватар успешно обновлён',

//       avatarUrl: updatedUser.image,
//     };
//   }
// }

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
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
  // async getCurrentUser(@CurrentUser('sub') userId: string) {
  //   return this.authService.getCurrentUser(userId);
  // }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@CurrentUser() user: User) {
    return user;
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
