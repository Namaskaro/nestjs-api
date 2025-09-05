import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { SubcategoriesService } from '../subcategories/subcategories.service';
import { BrandsService } from '../brands/brands.service';
import { CreateProductDto } from './dto/create-product.dto';
import { User, UserGender } from '@/prisma/generated';
import { generateBlurDataURL } from '@/src/shared/utils/generate-blur';
import { UpdateProductDto } from './dto/update-product.dto';
import { StorageService } from '../libs/storage/storage.service';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { CloudStorageService } from '@/src/cloud-storage/cloud-storage.service';
import { Prisma } from '@prisma/client';
import { FilterQueryDto } from './dto/filter-query-dto';

@Injectable()
export class ProductsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly subcategoryService: SubcategoriesService,
    private readonly brandService: BrandsService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly cloudStorage: CloudStorageService,
  ) {}

  async getAllProducts(searchTerm?: string) {
    if (searchTerm) return this.getSearchFilter(searchTerm);
    const products = await this.prismaService.product.findMany({
      orderBy: {
        title: 'desc',
      },
      include: {
        subcategory: {
          select: {
            name: true,
          },
        },
        brand: true,
        reviews: {
          select: {
            user: true,
            rating: true,
            text: true,
          },
        },
      },
    });
    return products;
  }

  // async getPaginatedProducts({
  //   page = 1,
  //   take = 20,
  //   searchTerm,
  //   cursor,
  //   category,
  //   brands,
  //   sort = 'createdAt',
  //   order = 'desc',
  // }: {
  //   page?: number;
  //   take?: number;
  //   searchTerm?: string;
  //   cursor?: string;
  //   category?: string;
  //   brands?: string[];
  //   sort?: 'price' | 'name' | 'createdAt';
  //   order?: 'asc' | 'desc';
  // }) {
  //   const isCursorPagination = !!cursor;
  //   const skip = isCursorPagination ? 0 : (page - 1) * take;

  //   const where: any = {};

  //   if (searchTerm) {
  //     where.title = {
  //       contains: searchTerm,
  //       mode: 'insensitive',
  //     };
  //   }

  //   if (category && category !== 'all') {
  //     where.subcategory = {
  //       name: category,
  //     };
  //   }

  //   if (brands && brands.length > 0 && !brands.includes('all')) {
  //     where.brand = {
  //       name: {
  //         in: brands,
  //       },
  //     };
  //   }

  //   const [items, total] = await this.prismaService.$transaction([
  //     this.prismaService.product.findMany({
  //       where,
  //       take,
  //       skip: isCursorPagination ? 1 : skip,
  //       ...(isCursorPagination && {
  //         cursor: { id: cursor },
  //       }),
  //       orderBy: {
  //         [sort]: order,
  //       },
  //       include: {
  //         brand: true,
  //         subcategory: { select: { name: true } },
  //         reviews: { select: { user: true, rating: true, text: true } },
  //       },
  //     }),
  //     this.prismaService.product.count({ where }),
  //   ]);

  //   const lastItem = items.length > 0 ? items[items.length - 1] : null;

  //   return {
  //     items,
  //     total,
  //     page,
  //     totalPages: Math.ceil(total / take),
  //     nextCursor: lastItem?.id ?? null,
  //   };
  // }

  async getPaginatedProducts(filters: FilterQueryDto) {
    const {
      page = 1,
      take = 10,
      cursor,
      searchTerm,
      category,
      subcategory,
      brands,
      sort = 'createdAt',
      order = 'desc',
    } = filters;

    const where: any = {
      ...(searchTerm && {
        title: {
          contains: searchTerm,
          mode: 'insensitive',
        },
      }),
      ...(category &&
        category !== 'all' && {
          subcategory: {
            is: {
              category: {
                is: {
                  slug: category,
                },
              },
            },
          },
        }),
      ...(brands &&
        !brands.includes('all') && { brand: { name: { in: brands } } }),
      ...(subcategory &&
        subcategory !== 'all' && {
          subcategory: { is: { name: subcategory } },
        }),
    };

    if (cursor) {
      // Cursor-based pagination
      const items = await this.prismaService.product.findMany({
        where,
        take,
        skip: 1,
        cursor: { id: cursor },
        orderBy: { [sort]: order },
        include: {
          brand: true,
          subcategory: { select: { name: true } },
          reviews: { select: { user: true, rating: true, text: true } },
        },
      });

      return {
        items,
        nextCursor: items.length === take ? items[take - 1].id : null,
      };
    }

    // Offset-based pagination
    const skip = (page - 1) * take;

    const [items, total] = await this.prismaService.$transaction([
      this.prismaService.product.findMany({
        where,
        skip,
        take,
        orderBy: { [sort]: order },
        include: {
          brand: true,
          subcategory: { select: { name: true } }, // <-- убрал products
          reviews: { select: { user: true, rating: true, text: true } },
        },
      }),
      this.prismaService.product.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / take),
    };
  }

  async getProductById(id: string) {
    const product = await this.prismaService.product.findUnique({
      where: {
        id,
      },
      include: {
        subcategory: {
          select: {
            name: true,
          },
        },
        brand: true,
        reviews: {
          select: {
            user: true,
            rating: true,
            text: true,
          },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('Товар не найден');
    }
    return product;
  }

  private getSearchFilter(searchTerm: string) {
    return {
      OR: [
        {
          title: {
            contains: searchTerm,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: searchTerm,
            mode: 'insensitive',
          },
        },
      ],
    };
  }

  async getProductsByGender(gender: UserGender) {
    const products = await this.prismaService.product.findMany({
      where: {
        gender,
      },
      orderBy: {
        title: 'desc',
      },
      include: {
        subcategory: {
          select: {
            name: true,
          },
        },
        brand: true,
        reviews: {
          select: {
            user: true,
            rating: true,
            text: true,
          },
        },
      },
    });

    return products;
  }

  // async create(data: CreateProductDto) {
  //   const blurURL = await Promise.all(
  //     data.images.map((img) => generateBlurDataURL(img)),
  //   );

  //   const product = await this.prismaService.product.create({
  //     data: {
  //       ...data,
  //       blurURL,
  //     },
  //   });

  //   return product;
  // }

  async create(data: CreateProductDto, files: Express.Multer.File[]) {
    const S3UserId = this.configService.get<string>('S3_USERNAME_ID');
    const S3Url = this.configService.get<string>('S3_URL');

    const uploadedImages: string[] = [];
    const blurURLs: string[] = [];

    for (const [index, file] of files.entries()) {
      // 1. Конвертируем в .webp и загружаем
      const webpBuffer = await sharp(file.buffer)
        .resize(800, 800, { fit: 'cover' }) // или нужные размеры
        .webp({ quality: 80 })
        .toBuffer();

      const fileName = `/products/${Date.now()}_${index}.webp`;

      await this.storageService.upload(webpBuffer, fileName, 'image/webp');

      const imageUrl = `https://${S3UserId}.${S3Url}${fileName}`;
      uploadedImages.push(imageUrl);

      // 2. Генерация blurDataURL
      const blur = await generateBlurDataURL(imageUrl);
      if (blur) {
        blurURLs.push(blur);
      }
    }

    // 3. Создание продукта в БД
    const product = await this.prismaService.product.create({
      data: {
        ...data,
        images: uploadedImages,
        blurURL: blurURLs,
      },
    });

    return product;
  }

  // async updateProduct(id: string, data: UpdateProductDto) {
  //   let blurURL: string[] | undefined = undefined;

  //   if (data.images) {
  //     blurURL = await Promise.all(
  //       data.images.map((img) => generateBlurDataURL(img)),
  //     );
  //   }

  //   const product = await this.prismaService.product.update({
  //     where: { id },
  //     data: {
  //       ...data,
  //       ...(blurURL && { blurURL }),
  //     },
  //   });

  //   return product;
  // }

  // async updateProduct(id: string, data: UpdateProductDto) {
  //   const {  subcategoryId, brandId, ...rest } = data;

  //   let imageUrls: string[] | undefined;
  //   let blurURL: string[] | undefined;

  //   if (images && images.length > 0) {
  //     imageUrls = await this.cloudStorage.uploadFiles(images);
  //     blurURL = await Promise.all(
  //       imageUrls.map((url) => generateBlurDataURL(url)),
  //     );
  //   } else {
  //     const existing = await this.prismaService.product.findUnique({
  //       where: { id },
  //       select: { images: true, blurURL: true },
  //     });

  //     if (!existing) {
  //       throw new NotFoundException('Товар не найден');
  //     }

  //     imageUrls = existing.images;
  //     blurURL = existing.blurURL;
  //   }

  //   const updatedProduct = await this.prismaService.product.update({
  //     where: { id },
  //     data: {
  //       ...rest,
  //       images: imageUrls,
  //       blurURL,
  //       ...(subcategoryId && {
  //         subcategory: { connect: { id: subcategoryId } },
  //       }),
  //       ...(brandId && { brand: { connect: { id: brandId } } }),
  //     },
  //   });

  //   return updatedProduct;
  // }

  async delete(id: string) {
    await this.getProductById(id);
    return this.prismaService.product.delete({
      where: {
        id,
      },
    });
  }
}
