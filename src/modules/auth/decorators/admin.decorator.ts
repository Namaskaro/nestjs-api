import { applyDecorators, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './role.decorator';
import { Role } from '@/prisma/generated';

export const Admin = () =>
  applyDecorators(Roles(Role.Admin), UseGuards(JwtAuthGuard, RolesGuard));
