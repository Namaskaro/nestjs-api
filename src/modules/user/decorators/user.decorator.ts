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
