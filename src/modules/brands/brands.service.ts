import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateBrandDto } from './dto/create-brand.dto';

@Injectable()
export class BrandsService {
  public constructor(private readonly prismaService: PrismaService) {}

  async getAllBrands() {
    const brands = await this.prismaService.brand.findMany({
      orderBy: {
        name: 'desc',
      },
    });
    return brands;
  }

  async getBrandById(id: string) {
    const brand = await this.prismaService.brand.findUnique({
      where: {
        id,
      },
    });
    return brand;
  }

  async getBrandsByFirstLetter(letter: string) {
    const brands = await this.prismaService.brand.findMany({
      where: {
        name: {
          startsWith: `${letter}`,
        },
      },
    });
    return brands;
  }

  async getBrandProducts(id: string) {
    const brand = await this.prismaService.brand.findUnique({
      where: {
        id,
      },
      include: {
        products: true,
      },
    });
    if (!brand) {
      throw new NotFoundException('Бренд не найден');
    }

    return brand.products;
  }
  async create(dto: CreateBrandDto) {
    return this.prismaService.brand.create({
      data: {
        ...dto,
      },
    });
  }

  async update(id: string, dto: CreateBrandDto) {
    await this.getBrandById(id);
    return this.prismaService.brand.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async delete(id: string) {
    await this.getBrandById(id);
    return this.prismaService.brand.delete({
      where: {
        id,
      },
    });
  }
}
