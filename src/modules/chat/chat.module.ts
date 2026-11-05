import { forwardRef, Module } from '@nestjs/common';

import { ChatService } from './chat.service';

import { ChatGateway } from './chat.gateway';

import { ChatHandoffService } from './chat-handoff.service';

import { ChatHandoffQueueService } from './chat-handoff-queue.service';

import { OperatorInvitationController } from './operator-invitation.controller';

import { UserService } from '../user/user.service';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { MailModule } from '@/src/mail/mail.module';

import { AuthModule } from '../auth/auth.module';

import { SupportAgentModule } from '@/src/support-agent/support-agent.module';

@Module({
  imports: [
    forwardRef(() => MailModule),
    forwardRef(() => AuthModule),
    SupportAgentModule,
  ],

  controllers: [OperatorInvitationController],

  providers: [
    ChatGateway,
    ChatService,
    ChatHandoffService,
    ChatHandoffQueueService,
    UserService,
    PrismaService,
  ],

  exports: [ChatService, ChatHandoffService, ChatHandoffQueueService],
})
export class ChatModule {}
