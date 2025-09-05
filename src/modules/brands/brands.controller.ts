import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/role.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '@/prisma/generated';
import { CreateBrandDto } from './dto/create-brand.dto';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  async getAllBrands() {
    return this.brandsService.getAllBrands();
  }

  @Post('/:id')
  async getBrandById(@Param('id') id: string) {
    return this.brandsService.getBrandById(id);
  }

  @Post('/brand/:letter')
  async getBrandsByFirstLetter(letter: string) {
    return this.brandsService.getBrandsByFirstLetter(letter);
  }

  @Post('/create')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async createBrand(@Body() dto: CreateBrandDto) {
    return this.brandsService.create(dto);
  }

  @Put('/:id')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async updateBrand(@Param('id') id: string, @Body() dto: CreateBrandDto) {
    return this.brandsService.update(id, dto);
  }

  @Delete('/:id')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async deleteBrand(@Param('id') id: string) {
    return this.brandsService.delete(id);
  }
}
