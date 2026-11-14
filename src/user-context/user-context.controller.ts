
import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '@/src/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/src/modules/user/decorators/user.decorator';
import { NextShopUserContext } from './next-shop-user-context.adapter';

const identifier = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);
const revision = z.number().int().min(0).max(2_147_483_646);
const preference = z.object({ domainKey: identifier, preferenceKey: identifier });
const confirmation = z.object({
  commandId: z.string().uuid(),
  expectedRevision: revision,
  evidence: z.object({
    chatId: z.string().uuid(),
    episodeId: z.string().uuid(),
    episodeRevision: revision.min(1),
    criterion: z.object({
      attributeId: identifier,
      operator: z.enum(['eq', 'contains', 'lte', 'gte']),
    }).strict(),
  }).strict(),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Некорректная команда контекста.');
  return result.data;
}

function parseRevision(value: unknown) {
  const raw = parse(z.string().regex(/^(0|[1-9]\d*)$/), value);
  return parse(revision, Number(raw));
}

@Controller('me/user-context')
@UseGuards(JwtAuthGuard)
export class UserContextController {
  constructor(private readonly context: NextShopUserContext) {}

  @Get()
  get(@CurrentUser() user: { id: string; role: string }) {
    return this.context.get(user);
  }

  @Put('preferences/:domainKey/:preferenceKey')
  confirm(@CurrentUser() user: { id: string; role: string }, @Param() params: unknown, @Body() body: unknown) {
    return this.context.confirm(user, { ...parse(preference, params), ...parse(confirmation, body) });
  }

  @Delete('preferences/:domainKey/:preferenceKey')
  removePreference(@CurrentUser() user: { id: string; role: string }, @Param() params: unknown,
    @Query('expectedRevision') expectedRevision: unknown) {
    return this.context.remove(user, parseRevision(expectedRevision), parse(preference, params));
  }

  @Delete()
  remove(@CurrentUser() user: { id: string; role: string }, @Query('expectedRevision') expectedRevision: unknown) {
    return this.context.remove(user, parseRevision(expectedRevision));
  }
}
