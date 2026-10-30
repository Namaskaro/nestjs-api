// Evidence for caller changes that require separate approval; no live services.
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { ChatGateway } from '../modules/chat/chat.gateway';
import type { ChatService } from '../modules/chat/chat.service';
import type { SupportAgentService } from '../support-agent/support-agent.service';
import type { Socket, Server } from 'socket.io';
import { createConsultationAgent } from '../product-consultation/application/consultation-agent/consultation.agent';
import type { AiService } from './ai.service';

// Auth/DB bootstrap is outside this handler contract; injected services below
// remain inert. Exercise the real ChatGateway method and its disconnect wiring.
jest.mock('../modules/auth/guards/ws-jwt.guard', () => ({
  WsJwtGuard: class {},
}));
jest.mock('../modules/chat/chat.service', () => ({ ChatService: class {} }));

describe('existing caller reliability gaps (unmodified application)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('the current Nest Socket.IO entrypoint does not cancel its run on disconnect', async () => {
    let finish!: (value: unknown) => void;
    const support = {
      isThreadActive: () => false,
      run: jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const chat = {
      assertUserCanAccessChat: jest.fn(async () => ({ mode: 'BOT' })),
      createMessage: jest.fn(async () => ({ id: 'message', content: 'Hello' })),
    };
    const gateway = new ChatGateway(
      chat as unknown as ChatService,
      support as unknown as SupportAgentService,
    );
    gateway.server = { to: () => ({ emit: jest.fn() }) } as unknown as Server;
    const socket = Object.assign(new EventEmitter(), {
      data: { user: { id: 'offline-user' } },
    });
    let completed = false;
    const running = gateway
      .sendMessage(
        socket as unknown as Socket,
        { chatId: 'chat', content: 'Hello' },
        jest.fn(),
      )
      .then(() => {
        completed = true;
      });
    await new Promise((resolve) => setImmediate(resolve));
    expect(support.run).toHaveBeenCalledTimes(1);
    expect(socket.listenerCount('disconnect')).toBe(0);
    socket.emit('disconnect');
    await new Promise((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(support.run.mock.calls[0]).toHaveLength(5); // No execution context.
    finish({ kind: 'interrupt', interrupt: { reason: 'fixture' } });
    await running;
  });

  it.each(['AuthenticationError', 'AbortError', 'TimeoutError'])(
    'Workspace currently repeats %s as if it were structured-output repair',
    async (name) => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const error = new Error('Injected');
      error.name = name;
      const invoke = jest.fn().mockRejectedValue(error);
      const unused = { withRetry: () => unused };
      const model = {
        withStructuredOutput: (_schema: unknown, options: { name: string }) =>
          options.name === 'product_workspace_decision' ? { invoke } : unused,
      };
      const agent = createConsultationAgent({
        getChatModel: () => model,
      } as unknown as AiService);
      await expect(
        agent.decideWorkspace({ currentMessage: 'Hello' }),
      ).rejects.toThrow('ProductWorkspacePlanner');
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );
});
