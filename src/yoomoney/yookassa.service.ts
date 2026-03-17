import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';

@Injectable()
export class YoomoneyService {
  public constructor(private readonly prismaService: PrismaService) {}

  async create() {
    console.log();
  }
}
