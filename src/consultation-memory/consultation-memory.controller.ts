import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '@/src/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/src/modules/user/decorators/user.decorator';
import { memoryCorrectionSchema } from './consultation-memory.core';
import { ConsultationMemoryService } from './consultation-memory.service';

const correction = z.object({
  revision: z.number().int().positive(),
  change: memoryCorrectionSchema,
}).strict();

@Controller('chat/:chatId/consultation-episodes')
@UseGuards(JwtAuthGuard)
export class ConsultationMemoryController {
  constructor(private readonly memory: ConsultationMemoryService) {}

  @Get()
  list(@Param('chatId', ParseUUIDPipe) chatId: string, @CurrentUser('id') userId: string) {
    return this.memory.list(chatId, userId);
  }

  @Patch(':episodeId')
  correct(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ) {
    const parsed = correction.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Некорректное исправление подбора.');
    return this.memory.correct(chatId, userId, episodeId, parsed.data.revision, parsed.data.change);
  }

  @Delete(':episodeId')
  @HttpCode(204)
  remove(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.memory.remove(chatId, userId, episodeId);
  }
}
