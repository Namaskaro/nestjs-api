import { forwardRef, Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
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
  providers: [ChatGateway, ChatService, UserService, PrismaService],
  exports: [ChatService],
})
export class ChatModule {}
