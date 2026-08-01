// import { User } from '@/prisma/generated';
// import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// export const CurrentUser = createParamDecorator(
//   (data: keyof User, ctx: ExecutionContext) => {
//     const request = ctx.switchToHttp().getRequest();
//     const user = request.user;

//     return data ? user[data] : user;
//   },
// );
// @CurrentUser('id') id: string Есдли прописываем ключ, то возвращаем только этот ключ, если не прописываем ключ, то возвращаем целого пользователя

// import { User } from '@/prisma/generated';
// import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// export const CurrentUser = createParamDecorator(
//   (
//     data: keyof User | undefined,
//     ctx: ExecutionContext,
//   ): User | User[keyof User] | null => {
//     const request = ctx.switchToHttp().getRequest();
//     const user: User | null = request.user ?? null;
//     return data ? (user ? user[data] : null) : user;
//   },
// );
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface AuthPayload {
  sub: string;
  iat?: number;
  exp?: number;
  id?: string;
}

export const CurrentUser = createParamDecorator(
  (field: keyof AuthPayload | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();

    const user = request.user as AuthPayload | undefined;

    if (!user) {
      return undefined;
    }

    if (field) {
      return user[field];
    }

    return user;
  },
);
