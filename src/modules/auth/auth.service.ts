import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { AuthDto } from '../user/dto/auth.dto';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { CreateGuestDto } from './dto/create-guest.dto';
import { Role } from '@/prisma/generated';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdateUserDto } from '../user/dto/user-update.dto';

const TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
  EXPIRE_DAY_REFRESH_TOKEN = 1;
  REFRESH_TOKEN_NAME = 'refreshToken';
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly jwt: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  // async createGuest() {
  //   const guest = await this.prismaService.user.create({
  //     data: {
  //       id: uuid(),
  //       role: Role.Guest,
  //     },
  //   });
  //   return guest;
  // }

  // async getGuest(userId: string) {
  //   const guest = await this.prismaService.user.findUnique({
  //     where: {
  //       id: userId,
  //     },
  //   });
  //   if (!guest) {
  //     throw new NotFoundException('Гость не найден!');
  //   }
  //   return guest;
  // }

  // async deleteGuest(userId: string) {
  //   await this.getGuest(userId);
  //   return this.prismaService.user.delete({
  //     where: {
  //       id: userId,
  //     },
  //   });
  // }

  async createGuest() {
    const guest = await this.prismaService.user.create({
      data: {
        // id можно не передавать, если в Prisma стоит @default(uuid())
        role: Role.Guest,
        isGuest: true, // <—
        lastSeen: new Date(),
      },
      select: { id: true, name: true },
    });
    return guest;
  }

  async getGuest(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { id: true, name: true, isGuest: true },
    });
    if (!user) throw new NotFoundException('Гость не найден!');
    if (!user.isGuest)
      throw new GoneException('Гость апгрейжен до обычного пользователя');
    return { id: user.id, name: user.name ?? null };
  }

  issueGuestAccessToken(userId: string) {
    const secret = this.configService.getOrThrow<string>('JWT_SECRET');
    return this.jwt.sign(
      { id: userId, isGuest: true }, // важен флаг
      { expiresIn: '14d', secret }, // срок гостя
    );
  }

  async ping(id: string): Promise<void> {
    await this.prismaService.user.updateMany({
      where: { id, isGuest: true }, // <— только для гостей
      data: { lastSeen: new Date() },
    });
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - TTL_MS);
    const res = await this.prismaService.user.deleteMany({
      where: { isGuest: true, lastSeen: { lt: cutoff } }, // <—
    });
    return res.count;
  }

  async upgradeGuest(id: string, data: UpdateUserDto) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { isGuest: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    return this.prismaService.user.update({
      where: { id },
      data: { ...data, role: Role.Client, isGuest: false }, // <—
    });
  }

  async deleteGuest(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { isGuest: true },
    });
    if (!user) throw new NotFoundException('Гость не найден!');
    if (!user.isGuest) throw new GoneException('Это уже не гость');

    return this.prismaService.user.delete({ where: { id } });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cronPurge() {
    try {
      await this.purgeExpired();
    } catch {}
  }

  async login(dto: AuthDto) {
    const user = await this.validateUser(dto);
    const tokens = this.issueTokens(user.id);

    return {
      user,
      ...tokens,
    };
  }

  async register(dto: AuthDto) {
    const isUserExist = await this.userService.getByEmail(dto.email);

    if (isUserExist) {
      throw new BadRequestException('Пользователь уже существует');
    }

    const user = await this.userService.create(dto);
    const tokens = this.issueTokens(user.id);
    console.log('Ебучая ошибка!!!');
    return {
      user,
      ...tokens,
    };
  }

  async getNewTokens(refreshToken: string) {
    const result = await this.jwt.verifyAsync(refreshToken);
    if (!result) throw new UnauthorizedException('Невалидный refresh токен');
    const user = await this.userService.getById(result.id);
    const tokens = this.issueTokens(user.id);

    return {
      user,
      ...tokens,
    };
  }

  issueTokens(userId: string) {
    const data = { id: userId };
    const accessToken = this.jwt.sign(data, {
      expiresIn: '1h',
    });
    const refreshToken = this.jwt.sign(data, {
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private async validateUser(dto: AuthDto) {
    const user = await this.userService.getByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('Пользователь с такой почтой не найден');
    }

    return user;
  }

  async validate0AuthLogin(req: any) {
    let user = await this.userService.getByEmail(req.user.email);
    if (!user) {
      user = await this.prismaService.user.create({
        data: {
          email: req.user.email,
          role: req.user.role,
          name: req.user.name,
          image: req.user.picture,
        },
        include: {
          favorites: true,
        },
      });
    }
    const tokens = this.issueTokens(user.id);

    return { user, ...tokens };
  }

  addRefreshTokenToResponse(res: Response, refreshToken: string) {
    const expiresIn = new Date();
    expiresIn.setDate(expiresIn.getDate() + this.EXPIRE_DAY_REFRESH_TOKEN);

    res.cookie(this.REFRESH_TOKEN_NAME, refreshToken, {
      httpOnly: true,
      domain: this.configService.get('SERVER_DOMAIN'),
      expires: expiresIn,
      secure: true,
      sameSite: 'none',
    });
  }

  removeRefreshTokenFromResponse(res: Response) {
    res.cookie(this.REFRESH_TOKEN_NAME, '', {
      httpOnly: true,
      domain: this.configService.get('SERVER_DOMAIN'),
      expires: new Date(0),
      secure: true,
      sameSite: 'none',
    });
  }
}
