import { User } from '@/prisma/generated';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: keyof User, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user[data] : user;
  },
);
// @CurrentUser('id') id: string Есдли прописываем ключ, то возвращаем только этот ключ, если не прописываем ключ, то возвращаем целого пользователя
