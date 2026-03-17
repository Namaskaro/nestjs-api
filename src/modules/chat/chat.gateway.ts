import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { ChatService } from './chat.service';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { JoinChatDto } from './dto/join-chat.dto';
import { UseGuards } from '@nestjs/common';
import { SendMessageDto } from './dto/send-message.dto';

@WebSocketGateway({ cors: { origin: true } })
export class ChatGateway {
  @WebSocketServer()
  server: Server;
  constructor(private readonly chatService: ChatService) {}

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chat:join')
  async joinChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: JoinChatDto,
  ) {
    await this.chatService.assertUserCanAccessChat(
      socket.data.user,
      dto.chatId,
    );

    socket.join(`chat:${dto.chatId}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chat:send_message')
  async sendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: SendMessageDto,
  ) {
    const message = await this.chatService.createMessage({
      chatId: dto.chatId,
      content: dto.content,
      user: socket.data.user,
    });

    this.server.to(`chat:${dto.chatId}`).emit('chat:new_message', message);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chat:request_operator')
  async requestOperator(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: JoinChatDto,
  ) {
    const chat = await this.chatService.assignOperator(dto.chatId);

    this.server.to(`chat:${dto.chatId}`).emit('chat:status_changed', chat);
  }
}
