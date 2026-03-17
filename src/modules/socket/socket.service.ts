import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SocketService implements OnGatewayConnection {
  handleConnection(client: any, ...args: any[]) {
    // console.log(client);
    // console.log('Connected!@!!@');
  }
}
