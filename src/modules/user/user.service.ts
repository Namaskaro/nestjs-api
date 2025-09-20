import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'argon2';
import { AuthDto } from './dto/auth.dto';
import { Role, User } from '@/prisma/generated';
import { StorageService } from '../libs/storage/storage.service';
import sharp = require('sharp');
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UserService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  async getById(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        id,
      },
      include: {
        favorites: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return user;
  }

  async getByEmail(email: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        email,
      },
      include: {
        favorites: true,
      },
    });

    // if (!user) {
    //   throw new NotFoundException('Пользователь не найден');
    // }

    return user;
  }

  async toggleFavorite(userId: string, productId: string) {
    const user = await this.getById(userId);

    const isProductInFavorites = user.favorites.some(
      (product) => product.id === productId,
    );

    await this.prismaService.user.update({
      where: {
        id: user.id,
      },
      data: {
        favorites: {
          [isProductInFavorites ? 'disconnect' : 'connect']: {
            id: productId,
          },
        },
      },
    });
    return true;
  }

  async getFavorites(userId: string) {
    const user = await this.getById(userId);
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
  }

  async create(dto: AuthDto) {
    return this.prismaService.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: Role.Client,
        password: await hash(dto.password),
      },
    });
  }

  async setUserBio(userId: string, dto: Record<string, any>) {
    return this.prismaService.user.update({
      where: {
        id: userId,
      },
      data: {
        bio: dto,
      },
    });
  }

  public async changeAvatar(user: User, file: Express.Multer.File) {
    if (user.image) {
      await this.storageService.remove(user.image); // удалить старый файл
    }

    const webpBuffer = await sharp(file.buffer)
      .resize(256, 256, { fit: 'cover' }) // можно изменить размеры по желанию
      .webp({ quality: 80 }) // качество webp
      .toBuffer();

    const fileName = `/avatars/${user.id}.webp`;

    await this.storageService.upload(webpBuffer, fileName, 'image/webp'); // сохранить новый файл
    const S3UserId = this.configService.get<string>('S3_USERNAME_ID');
    const S3Url = this.configService.get<string>('S3_URL');
    const imgUrl = `${S3UserId}.${S3Url}${fileName}`;
    await this.prismaService.user.update({
      where: { id: user.id },
      data: { image: imgUrl },
    });
  }
}

//   public async removeAvatar(user: User) {
//     if (!user.avatar) {
//       return;
//     }
//     await this.storageService.remove(user.avatar);

//     await this.prismaService.user.update({
//       where: {
//         id: user.id,
//       },
//       data: {
//         avatar: null,
//       },
//     });
//   }
// }
