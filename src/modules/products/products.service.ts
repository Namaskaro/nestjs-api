import { AiService } from './../../ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { SubcategoriesService } from '../subcategories/subcategories.service';
import { BrandsService } from '../brands/brands.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UserGender } from '@/prisma/generated';
import { generateBlurDataURL } from '@/src/shared/utils/generate-blur';

import { StorageService } from '../libs/storage/storage.service';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { CloudStorageService } from '@/src/cloud-storage/cloud-storage.service';

import { FilterQueryDto } from './dto/filter-query-dto';

import { ProductSemanticInputDto } from '@/src/ai/dto/product-semantic-input.dto';
import { QdrantService } from '@/src/core/qdrant/qdrant.service';
import { ProductQdrantPayloadSchema } from '@/src/ai/schemas/product-qdrant-payload.schema';
import { ProductQdrantPointDto } from '@/src/ai/dto/product-qdrant-point.dto';
import { Schemas } from '@qdrant/js-client-rest';

@Injectable()
export class ProductsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly subcategoryService: SubcategoriesService,
    private readonly brandService: BrandsService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly cloudStorage: CloudStorageService,
    private readonly aiService: AiService,
    private readonly qdrantService: QdrantService,
  ) {}

  async getAllProducts(searchTerm?: string) {
    return this.prismaService.product.findMany({
      where: searchTerm ? this.getSearchFilter(searchTerm) : undefined,
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
  }

  async getPaginatedProducts(filters: FilterQueryDto) {
    const {
      page = 1,
      take = 12,
      cursor,
      searchTerm,
      category,
      subcategory,
      brand,
      sort = 'createdAt',
      order = 'desc',
    } = filters;

    const brandsArray = Array.isArray(brand) ? brand : brand ? [brand] : [];

    const where: any = {
      ...(searchTerm && {
        title: { contains: searchTerm, mode: 'insensitive' },
      }),
      ...(category &&
        category !== 'all' && {
          subcategory: { is: { category: { is: { slug: category } } } },
        }),
      ...(brandsArray.length > 0 &&
        !brandsArray.includes('all') && {
          brand: {
            name: {
              in: brandsArray,
              mode: 'insensitive',
            },
          },
        }),
      ...(subcategory &&
        ((Array.isArray(subcategory) && !subcategory.includes('all')) ||
          (typeof subcategory === 'string' && subcategory !== 'all')) &&
        (Array.isArray(subcategory)
          ? { subcategory: { name: { in: subcategory } } }
          : { subcategory: { name: subcategory } })),
    };

    // общий include
    const include = {
      brand: true,
      subcategory: { select: { name: true } },
      reviews: { select: { user: true, rating: true, text: true } },
    } as const;

    // общий стабильный orderBy (по выбранному полю + tie-break по id)
    const orderBy = [{ [sort]: order } as any, { id: order }];

    if (cursor) {
      // 1) валидируем анкер курсора (если его нет — отдаём пусто, без 404)
      const anchor = await this.prismaService.product.findUnique({
        where: { id: cursor },
        select: { id: true },
      });
      if (!anchor) {
        return { items: [], nextCursor: null };
      }

      // 2) курсорная страница
      const items = await this.prismaService.product.findMany({
        where,
        take,
        skip: 1,
        cursor: { id: anchor.id },
        orderBy,
        include,
      });

      return {
        items,
        nextCursor: items.length === take ? items[items.length - 1].id : null,
      };
    }

    // offset-страница
    const skip = (page - 1) * take;

    const [items, total] = await this.prismaService.$transaction([
      this.prismaService.product.findMany({
        where,
        skip,
        take,
        orderBy,
        include,
      }),
      this.prismaService.product.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / take),
      // важное: сразу подготовим корректный nextCursor для клиента
      nextCursor:
        page < Math.ceil(total / take) && items.length > 0
          ? items[items.length - 1].id
          : null,
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
            mode: 'insensitive' as const,
          },
        },
        {
          description: {
            contains: searchTerm,
            mode: 'insensitive' as const,
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
      include: {
        brand: true,
        subcategory: {
          include: {
            category: true,
          },
        },
      },
    });

    //     const dto: CreateProductEmbeddingText = {
    //       title: product.title,
    //       description: product.description,
    //       brand: product.brand.name,
    //       subcategory: product.subcategory.name,
    //       price: product.price,
    //     };

    //     const textForEmbedding = await this.aiService.buildProductEmbeddingText(
    //       dto,
    //     );

    //     const productEmbeddings = await this.aiService.createProductEmbedding(
    //       textForEmbedding,
    //     );

    //     await this.prismaService.$executeRaw`
    //   INSERT INTO "ProductEmbedding" ("productId", "vector")
    //   VALUES (
    //     ${product.id},
    //     ${JSON.stringify(productEmbeddings)}::vector
    //   )
    // `;

    const semanticInput: ProductSemanticInputDto = {
      title: product.title,
      description: product.description,
      brand: product.brand.name,
      category: product.subcategory.name,
      color: 'gray',
      price: product.price,
    };

    const semanticRepresentation =
      await this.aiService.createProductSemanticRepresentation(semanticInput);

    const searchText = this.aiService.buildProductSearchText(
      semanticInput,
      semanticRepresentation,
    );

    const denseEmbedding = await this.aiService.createEmbedding(searchText);

    const payload = ProductQdrantPayloadSchema.parse({
      productId: product.id,

      title: product.title,
      description: product.description,

      brand: product.brand.name,
      category: product.subcategory.category.name,
      subcategory: product.subcategory.name,

      color: 'gray',
      price: product.price,

      image: product.images[0] ?? '',
      inStock: product.inStock,

      semanticRepresentation,
    });

    const point: Schemas['PointStruct'] = {
      id: product.id,

      vector: {
        dense: denseEmbedding,

        bm25: {
          text: searchText,
          model: 'qdrant/bm25',
        },
      },

      payload,
    };

    await this.qdrantService.savePoint('products', point);

    return product;
  }

  async delete(id: string) {
    await this.getProductById(id);
    return this.prismaService.product.delete({
      where: {
        id,
      },
    });
  }
}
