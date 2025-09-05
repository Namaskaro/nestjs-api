import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  public constructor(private readonly prismaService: PrismaService) {}

  async getAllCategories() {
    const categories = await this.prismaService.category.findMany({
      orderBy: {
        name: 'desc',
      },
      include: {
        subcategories: true,
      },
    });
    return categories;
  }

  async getCategoryById(id: string) {
    const category = await this.prismaService.category.findUnique({
      where: {
        id,
      },
      include: {
        subcategories: true,
      },
    });
    return category;
  }

  async getCategorySubcategories(categoryId: string) {
    const category = await this.prismaService.category.findUnique({
      where: {
        id: categoryId,
      },
      include: {
        subcategories: true,
      },
    });

    return category.subcategories;
  }

  async create(dto: CreateCategoryDto) {
    return this.prismaService.category.create({
      data: {
        ...dto,
      },
    });
  }

  async update(id: string, dto: CreateCategoryDto) {
    await this.getCategoryById(id);
    return this.prismaService.category.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async delete(id: string) {
    await this.getCategoryById(id);
    return this.prismaService.category.delete({
      where: {
        id,
      },
    });
  }
}
