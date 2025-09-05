import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SubcategoriesService } from './subcategories.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/role.decorator';
import { Role } from '@/prisma/generated';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';

@Controller('subcategories')
export class SubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Get('/')
  @HttpCode(200)
  async getAllSubcategories() {
    return this.subcategoriesService.getAllSubcategories();
  }

  @Get('/:id')
  @HttpCode(200)
  async getSubcategoryById(id: string) {
    return this.subcategoriesService.getSubcategoryById(id);
  }

  @Get('/name')
  @HttpCode(200)
  async getSubcategoryByName(name: string) {
    return this.subcategoriesService.getSubcategoryByName(name);
  }

  @Get('/:id/products')
  @HttpCode(200)
  async getSubcategoryProducts(id: string) {
    return this.subcategoriesService.getSubcategoryProducts(id);
  }

  @Post('/create')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async createSubcategory(dto: CreateSubcategoryDto) {
    return this.subcategoriesService.create(dto);
  }

  @Put('/:id')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async updateSubcategory(id: string, dto: CreateSubcategoryDto) {
    return this.subcategoriesService.update(id, dto);
  }

  @Delete('/:id')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async deleteSubcategory(id: string) {
    return this.subcategoriesService.delete(id);
  }
}
