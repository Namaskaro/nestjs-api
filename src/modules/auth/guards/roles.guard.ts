// import { Role } from '@/prisma/generated';
// import {
//   Injectable,
//   CanActivate,
//   ExecutionContext,
//   Inject,
// } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import { ROLES_KEY } from '../decorators/role.decorator';
// import { AuthGuard } from '@nestjs/passport';

// @Injectable()
// export class RolesGuard extends AuthGuard('jwt') {
//   constructor(@Inject(Reflector) private readonly reflector: Reflector) {
//     super();
//   }

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const baseGuardResult = await super.canActivate(context);
//     if (!baseGuardResult) {
//       // unsuccessful authentication return false
//       return false;
//     }
//     const requiredRoles = this.reflector.get<Role[]>(
//       ROLES_KEY,
//       context.getHandler(),
//     );
//     console.log(requiredRoles);
//     if (!requiredRoles) {
//       return true;
//     }
//     const request = context.switchToHttp().getRequest();
//     const user = request.user;
//     console.log(user);
//     return requiredRoles.includes(user.role);
//   }
// }

import { Role } from '@/prisma/generated';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/role.decorator';

interface AuthenticatedUser {
  id: string;
  role: Role;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // На маршруте нет @Roles() — проверка роли не требуется.
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    const user = request.user;

    if (!user) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}
