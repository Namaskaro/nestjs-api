import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { SpeechService } from './speech.service';

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:5173',
    credentials: true,
  },
})
export class SpeechGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SpeechGateway.name);

  constructor(private readonly speechService: SpeechService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.speechService.stopSession(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('speech:start')
  handleSpeechStart(@ConnectedSocket() client: Socket): void {
    try {
      this.speechService.startSession(client.id, {
        onPartial: (text) => {
          client.emit('speech:partial', { text });
        },
        onFinal: ({ segmentId, text }) => {
          console.log('[Gateway → frontend]', {
            segmentId,
            text,
          });

          client.emit('speech:final', {
            segmentId,
            text,
          });
        },
        onError: (error) => {
          client.emit('speech:error', { message: error.message });
        },
        onClose: () => {
          client.emit('speech:closed');
        },
      });
      client.emit('speech:ready');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown speech error';
      client.emit('speech:error', { message });
    }
  }

  @SubscribeMessage('speech:audio')
  handleSpeechAudio(
    @ConnectedSocket() client: Socket,
    @MessageBody() audio: Buffer | ArrayBuffer | Uint8Array,
  ): void {
    try {
      const buffer = this.toBuffer(audio);
      this.speechService.writeAudio(client.id, buffer);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown audio error';
      client.emit('speech:error', { message });
    }
  }

  @SubscribeMessage('speech:stop')
  handleSpeechStop(@ConnectedSocket() client: Socket): void {
    this.speechService.stopSession(client.id);
  }

  private toBuffer(audio: Buffer | ArrayBuffer | Uint8Array): Buffer {
    if (Buffer.isBuffer(audio)) {
      return audio;
    }
    if (audio instanceof ArrayBuffer) {
      return Buffer.from(audio);
    }
    return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  }
}
