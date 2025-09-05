import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { Role, UserGender } from '@/prisma/generated';
import { Roles } from '../auth/decorators/role.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FilterQueryDto } from './dto/filter-query-dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getAllProducts(@Query('searchTerm') searchTerm?: string) {
    return this.productsService.getAllProducts(searchTerm);
  }

  // @Get('/paginated')
  // getPaginatedProducts(
  //   @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  //   @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  //   @Query('search') search?: string,
  // ) {
  //   return this.productsService.getPaginatedProducts(page, limit, search);
  // }

  @Get('/filtered')
  async getPaginatedProducts(@Query() filters: FilterQueryDto) {
    return this.productsService.getPaginatedProducts(filters);
  }

  @Get('/:id')
  async getProductById(@Param('id') id: string) {
    return this.productsService.getProductById(id);
  }

  @Get('/:gender')
  async getProductByGender(@Param('gender') gender: UserGender) {
    return this.productsService.getProductsByGender(gender);
  }

  @Post('/create')
  @UseInterceptors(FilesInterceptor('images', 5)) // ← имя поля из form-data
  async create(
    @Body() createProductDto: CreateProductDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.productsService.create(createProductDto, files);
  }

  // @Post('/create')
  // @Auth()
  // @Roles(Role.Admin)
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // async createProduct(@Body() dto: CreateProductDto) {
  //   return this.productsService.create(dto);
  // }

  // @Put('/:id')
  // @Auth()
  // @Roles(Role.Admin)
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // async updateProduct(@Param('id') id: string, @Body() dto: CreateProductDto) {
  //   return this.productsService.update(id, dto);
  // }

  @Delete('/:id')
  @Auth()
  @Roles(Role.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async deleteProduct(@Param('id') id: string) {
    return this.productsService.delete(id);
  }
}
