import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';

@Injectable()
export class SubcategoriesService {
  public constructor(private readonly prismaService: PrismaService) {}

  async getAllSubcategories() {
    const subcategories = await this.prismaService.subcategory.findMany({
      orderBy: {
        name: 'desc',
      },
    });

    return subcategories;
  }

  async getSubcategoryById(id: string) {
    const subcategory = await this.prismaService.subcategory.findUnique({
      where: {
        id,
      },
    });

    return subcategory;
  }

  async getSubcategoryByName(name: string) {
    const subcategory = await this.prismaService.subcategory.findUnique({
      where: {
        name,
      },
    });

    return subcategory;
  }

  async getSubcategoryProducts(id: string) {
    const subcategory = await this.prismaService.subcategory.findUnique({
      where: {
        id,
      },
      include: {
        products: true,
      },
    });

    return subcategory.products;
  }

  async create(dto: CreateSubcategoryDto) {
    return this.prismaService.subcategory.create({
      data: {
        ...dto,
      },
    });
  }

  async update(id: string, dto: CreateSubcategoryDto) {
    await this.getSubcategoryById(id);
    return this.prismaService.subcategory.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async delete(id: string) {
    await this.getSubcategoryById(id);
    return this.prismaService.subcategory.delete({
      where: {
        id,
      },
    });
  }
}
