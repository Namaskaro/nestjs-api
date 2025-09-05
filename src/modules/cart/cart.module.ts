import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { UserService } from '../user/user.service';

@Module({
  controllers: [CartController],
  providers: [
    CartService,
    JwtService,
    ConfigService,
    PrismaService,
    UserService,
  ],
  exports: [CartService],
})
export class CartModule {}
