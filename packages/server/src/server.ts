import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import {
  type SkynetMessage,
  type AgentCard,
  type JoinRequest,
  type AgentJoinPayload,
  type AgentLeavePayload,
  MessageType,
  ClientAction,
  createMessage,
  deserialize,
  serialize,
} from '@skynet/protocol';
import { RoomManager } from './room.js';
import { MessageStore } from './store.js';

export interface SkynetServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
}

export class SkynetServer {
  private fastify = Fastify({ logger: true });
  private rooms = new RoomManager();
  private store: MessageStore;
  private socketAgentMap = new WeakMap<WebSocket, { agentId: string; roomId: string }>();

  constructor(private options: SkynetServerOptions = {}) {
    this.store = new MessageStore(options.dbPath);
  }

  async start(): Promise<void> {
    await this.fastify.register(websocket);

    // HTTP health check
    this.fastify.get('/health', async () => ({ status: 'ok', rooms: this.rooms.listRooms() }));

    // HTTP: list rooms
    this.fastify.get('/api/rooms', async () => this.rooms.listRooms());

    // HTTP: get room members
    this.fastify.get<{ Params: { roomId: string } }>('/api/rooms/:roomId/members', async (req) => {
      const room = this.rooms.get(req.params.roomId);
      return room ? room.getMembers() : [];
    });

    // HTTP: get room messages
    this.fastify.get<{ Params: { roomId: string }; Querystring: { limit?: string; before?: string } }>(
      '/api/rooms/:roomId/messages',
      async (req) => {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
        const before = req.query.before ? parseInt(req.query.before, 10) : undefined;
        return this.store.getByRoom(req.params.roomId, limit, before);
      },
    );

    // WebSocket endpoint
    this.fastify.get('/ws', { websocket: true }, (socket) => {
      this.handleConnection(socket);
    });

    const port = this.options.port ?? 4117;
    const host = this.options.host ?? '0.0.0.0';
    await this.fastify.listen({ port, host });
  }

  private handleConnection(socket: WebSocket): void {
    socket.on('message', (raw: RawData) => {
      try {
        const envelope = JSON.parse(raw.toString());
        this.handleClientAction(socket, envelope);
      } catch (err) {
        socket.send(JSON.stringify({ event: 'error', data: { message: 'Invalid message format' } }));
      }
    });

    socket.on('close', () => {
      this.handleDisconnect(socket);
    });
  }

  private handleClientAction(socket: WebSocket, envelope: { action: string; data: unknown }): void {
    switch (envelope.action) {
      case ClientAction.JOIN:
        this.handleJoin(socket, envelope.data as JoinRequest);
        break;
      case ClientAction.LEAVE:
        this.handleDisconnect(socket);
        break;
      case ClientAction.SEND:
        this.handleSend(socket, envelope.data as SkynetMessage);
        break;
      case ClientAction.HEARTBEAT:
        this.handleHeartbeat(socket, envelope.data as { agentId: string; status: AgentCard['status'] });
        break;
      default:
        socket.send(JSON.stringify({ event: 'error', data: { message: `Unknown action: ${envelope.action}` } }));
    }
  }

  private handleJoin(socket: WebSocket, req: JoinRequest): void {
    const room = this.rooms.getOrCreate(req.roomId);
    room.join(req.agent, socket);
    this.socketAgentMap.set(socket, { agentId: req.agent.agentId, roomId: req.roomId });

    // Notify the joining agent of current members
    socket.send(JSON.stringify({
      event: 'room.state',
      data: {
        roomId: req.roomId,
        members: room.getMembers(),
        recentMessages: this.store.getByRoom(req.roomId, 50),
      },
    }));

    // Broadcast join to others
    const joinMsg = createMessage({
      type: MessageType.AGENT_JOIN,
      from: req.agent.agentId,
      to: null,
      roomId: req.roomId,
      payload: { agent: req.agent } satisfies AgentJoinPayload,
    });
    this.store.save(joinMsg);
    room.broadcast(joinMsg, req.agent.agentId);
  }

  private handleSend(socket: WebSocket, msg: SkynetMessage): void {
    const info = this.socketAgentMap.get(socket);
    if (!info) {
      socket.send(JSON.stringify({ event: 'error', data: { message: 'Not joined to any room' } }));
      return;
    }

    // Ensure message has proper fields
    const fullMsg = createMessage({
      ...msg,
      from: info.agentId,
      roomId: info.roomId,
    });

    this.store.save(fullMsg);

    const room = this.rooms.get(info.roomId);
    if (!room) return;

    if (fullMsg.to) {
      // Point-to-point
      room.sendTo(fullMsg.to, fullMsg);
      // Also send back to sender as confirmation
      socket.send(serialize(fullMsg));
    } else {
      // Broadcast (including back to sender)
      room.broadcast(fullMsg);
    }
  }

  private handleHeartbeat(socket: WebSocket, data: { agentId: string; status: AgentCard['status'] }): void {
    const info = this.socketAgentMap.get(socket);
    if (!info) return;

    const room = this.rooms.get(info.roomId);
    if (room) {
      room.updateStatus(data.agentId, data.status);
    }

    socket.send(JSON.stringify({ event: 'heartbeat.ack', data: { timestamp: Date.now() } }));
  }

  private handleDisconnect(socket: WebSocket): void {
    const info = this.socketAgentMap.get(socket);
    if (!info) return;

    const room = this.rooms.get(info.roomId);
    if (room) {
      room.leave(info.agentId);

      const leaveMsg = createMessage({
        type: MessageType.AGENT_LEAVE,
        from: info.agentId,
        to: null,
        roomId: info.roomId,
        payload: { agentId: info.agentId } satisfies AgentLeavePayload,
      });
      this.store.save(leaveMsg);
      room.broadcast(leaveMsg);

      this.rooms.removeIfEmpty(info.roomId);
    }

    this.socketAgentMap.delete(socket);
  }

  async stop(): Promise<void> {
    await this.fastify.close();
    this.store.close();
  }
}
