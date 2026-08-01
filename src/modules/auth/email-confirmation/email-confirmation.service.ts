import { TokenType, User } from '@/prisma/generated';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';
import { ConfirmationDto } from './dto/confirmation.dto';
import { MailService } from '@/src/mail/mail.service';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';

export const RESEND_TOKEN = 'RESEND_TOKEN';

@Injectable()
export class EmailConfirmationService {
  public constructor(
    @Inject(RESEND_TOKEN) private readonly resend: Resend,
    private readonly prismaService: PrismaService,
    private readonly mailService: MailService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  // public async newVerification(req: Request, dto: ConfirmationDto) {
  //   const existingToken = await this.prismaService.token.findUnique({
  //     where: {
  //       token: dto.token,
  //       type: TokenType.VERIFICATION,
  //     },
  //   });

  //   if (!existingToken) {
  //     throw new NotFoundException('Токен подтверждения не найден!');
  //   }

  //   const hasExpired = new Date(existingToken.expiresIn) < new Date();

  //   if (hasExpired) {
  //     throw new BadRequestException(
  //       'Токен подтверждения истек. Пожалуйста запросите новый токен для подтверждения!',
  //     );
  //   }

  //   const existingUser = await this.userService.getByEmail(existingToken.email);

  //   if (!existingUser) {
  //     throw new NotFoundException(
  //       'Пользователь с указанным адресом электронной почты не найден. Пожалуйста убедитесь что вы ввели правильный email.',
  //     );
  //   }

  //   await this.prismaService.user.update({
  //     where: {
  //       id: existingUser.id,
  //     },
  //     data: {
  //       emailVerified: true,
  //     },
  //   });

  //   await this.prismaService.token.delete({
  //     where: {
  //       id: existingToken.id,
  //       type: TokenType.VERIFICATION,
  //     },
  //   });
  // }

  public async newVerification(dto: ConfirmationDto) {
    const existingToken = await this.prismaService.token.findUnique({
      where: {
        token: dto.token,
        type: TokenType.VERIFICATION,
      },
    });

    if (!existingToken) {
      throw new NotFoundException('Токен подтверждения не найден!');
    }

    const now = new Date();
    const expiresIn = new Date(existingToken.expiresIn);

    if (expiresIn.getTime() <= now.getTime()) {
      throw new BadRequestException(
        'Токен подтверждения истёк. Запросите новый токен.',
      );
    }

    const existingUser = await this.userService.getByEmail(existingToken.email);

    if (!existingUser) {
      throw new NotFoundException(
        'Пользователь с указанным адресом электронной почты не найден.',
      );
    }

    await this.prismaService.$transaction([
      this.prismaService.user.update({
        where: {
          id: existingUser.id,
        },
        data: {
          emailVerified: true,
        },
      }),

      // deleteMany не выбросит Prisma P2025,
      // если конкурентный запрос уже успел удалить токен
      this.prismaService.token.deleteMany({
        where: {
          id: existingToken.id,
          type: TokenType.VERIFICATION,
        },
      }),
    ]);

    return {
      message: 'Почта успешно подтверждена',
    };
  }

  public async sendVerificationToken(email: string) {
    const verificationToken = await this.generateVerificationToken(email);
    await this.mailService.sendConfirmationEmail(
      verificationToken.email,
      verificationToken.token,
    );

    return true;
  }

  private async generateVerificationToken(email: string) {
    const token = uuidv4();
    const expiresIn = new Date(new Date().getTime() + 3600 * 1000);

    const existingToken = await this.prismaService.token.findFirst({
      where: {
        email,
        type: TokenType.VERIFICATION,
      },
    });

    if (existingToken) {
      await this.prismaService.token.delete({
        where: {
          id: existingToken.id,
          type: TokenType.VERIFICATION,
        },
      });
    }

    const verificationToken = await this.prismaService.token.create({
      data: {
        email,
        token,
        expiresIn,
        type: TokenType.VERIFICATION,
      },
    });

    return verificationToken;
  }

  public async resendVerification(email: string) {
    const user = await this.userService.getByEmail(email);

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email уже подтвержден');
    }

    await this.sendVerificationToken(email);

    return {
      message: 'Письмо для подтверждения отправлено повторно',
    };
  }
}
