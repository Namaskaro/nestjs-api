import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { ProductsService } from '../products/products.service';

@Injectable()
export class ReviewsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async getProductReviews(productId: string) {
    const product = await this.prismaService.product.findFirst({
      where: {
        id: productId,
      },
      include: {
        // reviews: true,
        reviews: {
          select: {
            id: true,
            rating: true,
            text: true,
            createdAt: true,
            user: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!product) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Такой товар не найден',
        error: 'Not Found',
      });
    }

    return product.reviews;
  }

  async createReview(data: CreateReviewDto) {
    return await this.prismaService.review.create({
      data: {
        userId: data.userId,
        productId: data.productId,
        text: data.text,
        rating: data.rating ?? 0,
      },
    });
  }
}
