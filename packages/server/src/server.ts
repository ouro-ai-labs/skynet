import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import {
  type SkynetMessage,
  type AgentCard,
  type AgentProfile,
  type HumanProfile,
  type JoinRequest,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type MemberType,
  AgentType,
  MessageType,
  ClientAction,
  createMessage,
  deserialize,
  serialize,
} from '@skynet/protocol';
import { RoomManager } from './room.js';
import type { Store } from './store.js';

export interface SkynetServerOptions {
  port?: number;
  host?: string;
  store: Store;
}

export class SkynetServer {
  private fastify = Fastify({ logger: true });
  private rooms = new RoomManager();
  private store: Store;
  private socketAgentMap = new WeakMap<WebSocket, { agentId: string; roomId: string }>();

  constructor(private options: SkynetServerOptions) {
    this.store = options.store;
    this.restoreRooms();
  }

  private restoreRooms(): void {
    for (const persisted of this.store.listRooms()) {
      this.rooms.getOrCreate(persisted.id);
    }
  }

  async start(): Promise<void> {
    await this.fastify.register(websocket);

    this.registerHealthRoutes();
    this.registerRoomRoutes();
    this.registerAgentRoutes();
    this.registerHumanRoutes();
    this.registerNameRoutes();
    this.registerWebSocket();

    const port = this.options.port ?? 4117;
    const host = this.options.host ?? '0.0.0.0';
    await this.fastify.listen({ port, host });
  }

  private registerHealthRoutes(): void {
    this.fastify.get('/health', async () => ({ status: 'ok', rooms: this.rooms.listRooms() }));
  }

  private registerRoomRoutes(): void {
    // List rooms
    this.fastify.get('/api/rooms', async () => {
      const persisted = this.store.listRooms();
      return persisted.map((r) => {
        const room = this.rooms.get(r.id);
        return { id: r.id, name: r.name, memberCount: room?.size ?? 0 };
      });
    });

    // Get room members (connected WebSocket members)
    this.fastify.get<{ Params: { roomId: string } }>('/api/rooms/:roomId/members', async (req) => {
      const room = this.rooms.get(req.params.roomId);
      return room ? room.getMembers() : [];
    });

    // Create room (now takes { name } and auto-generates UUID)
    this.fastify.post<{ Body: { name: string } }>('/api/rooms', async (req, reply) => {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!this.store.checkNameUnique(name)) {
        return reply.status(409).send({ error: `Name '${name}' is already taken` });
      }
      const id = randomUUID();
      this.store.saveRoom({ id, name });
      this.rooms.getOrCreate(id);
      return reply.status(201).send({ id, name, memberCount: 0 });
    });

    // Destroy room
    this.fastify.delete<{ Params: { roomId: string } }>('/api/rooms/:roomId', async (req, reply) => {
      const result = this.rooms.remove(req.params.roomId);
      if (!result.removed) {
        return reply.status(404).send({ error: result.reason });
      }
      this.store.deleteRoom(req.params.roomId);
      return { ok: true };
    });

    // Get room messages
    this.fastify.get<{ Params: { roomId: string }; Querystring: { limit?: string; before?: string } }>(
      '/api/rooms/:roomId/messages',
      async (req) => {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
        const before = req.query.before ? parseInt(req.query.before, 10) : undefined;
        return this.store.getByRoom(req.params.roomId, limit, before);
      },
    );

    // Get room registered members (from DB, not WebSocket connections)
    this.fastify.get<{ Params: { roomId: string } }>('/api/rooms/:roomId/registered-members', async (req) => {
      return this.store.getRoomMembers(req.params.roomId);
    });
  }

  private registerAgentRoutes(): void {
    // Create agent
    this.fastify.post<{ Body: { name: string; type: string; role?: string; persona?: string } }>(
      '/api/agents',
      async (req, reply) => {
        const { name, type, role, persona } = req.body;
        if (!name || typeof name !== 'string') {
          return reply.status(400).send({ error: 'name is required' });
        }
        if (!type || typeof type !== 'string') {
          return reply.status(400).send({ error: 'type is required' });
        }
        if (!this.store.checkNameUnique(name)) {
          return reply.status(409).send({ error: `Name '${name}' is already taken` });
        }
        const agent: AgentProfile = {
          id: randomUUID(),
          name,
          type: type as AgentType,
          role,
          persona,
          createdAt: Date.now(),
        };
        this.store.saveAgent(agent);
        return reply.status(201).send(agent);
      },
    );

    // List agents
    this.fastify.get('/api/agents', async () => this.store.listAgents());

    // Get agent by ID or name
    this.fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
      const agent = this.store.getAgent(req.params.id);
      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      return agent;
    });

    // Agent joins room
    this.fastify.post<{ Params: { id: string; roomId: string } }>(
      '/api/agents/:id/join/:roomId',
      async (req, reply) => {
        const agent = this.store.getAgent(req.params.id);
        if (!agent) {
          return reply.status(404).send({ error: 'Agent not found' });
        }
        const roomId = this.resolveRoomId(req.params.roomId);
        if (!roomId) {
          return reply.status(404).send({ error: 'Room not found' });
        }
        this.store.addRoomMember(roomId, agent.id, 'agent');
        return { ok: true, roomId, agentId: agent.id };
      },
    );

    // Agent leaves room
    this.fastify.post<{ Params: { id: string; roomId: string } }>(
      '/api/agents/:id/leave/:roomId',
      async (req, reply) => {
        const agent = this.store.getAgent(req.params.id);
        if (!agent) {
          return reply.status(404).send({ error: 'Agent not found' });
        }
        const roomId = this.resolveRoomId(req.params.roomId);
        if (!roomId) {
          return reply.status(404).send({ error: 'Room not found' });
        }
        this.store.removeRoomMember(roomId, agent.id);
        return { ok: true };
      },
    );
  }

  private registerHumanRoutes(): void {
    // Create human
    this.fastify.post<{ Body: { name: string } }>('/api/humans', async (req, reply) => {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!this.store.checkNameUnique(name)) {
        return reply.status(409).send({ error: `Name '${name}' is already taken` });
      }
      const human: HumanProfile = {
        id: randomUUID(),
        name,
        createdAt: Date.now(),
      };
      this.store.saveHuman(human);
      return reply.status(201).send(human);
    });

    // List humans
    this.fastify.get('/api/humans', async () => this.store.listHumans());

    // Get human by ID or name
    this.fastify.get<{ Params: { id: string } }>('/api/humans/:id', async (req, reply) => {
      const human = this.store.getHuman(req.params.id);
      if (!human) {
        return reply.status(404).send({ error: 'Human not found' });
      }
      return human;
    });

    // Human joins room
    this.fastify.post<{ Params: { id: string; roomId: string } }>(
      '/api/humans/:id/join/:roomId',
      async (req, reply) => {
        const human = this.store.getHuman(req.params.id);
        if (!human) {
          return reply.status(404).send({ error: 'Human not found' });
        }
        const roomId = this.resolveRoomId(req.params.roomId);
        if (!roomId) {
          return reply.status(404).send({ error: 'Room not found' });
        }
        this.store.addRoomMember(roomId, human.id, 'human');
        return { ok: true, roomId, humanId: human.id };
      },
    );

    // Human leaves room
    this.fastify.post<{ Params: { id: string; roomId: string } }>(
      '/api/humans/:id/leave/:roomId',
      async (req, reply) => {
        const human = this.store.getHuman(req.params.id);
        if (!human) {
          return reply.status(404).send({ error: 'Human not found' });
        }
        const roomId = this.resolveRoomId(req.params.roomId);
        if (!roomId) {
          return reply.status(404).send({ error: 'Room not found' });
        }
        this.store.removeRoomMember(roomId, human.id);
        return { ok: true };
      },
    );
  }

  private registerNameRoutes(): void {
    this.fastify.get<{ Querystring: { name: string } }>('/api/names/check', async (req, reply) => {
      const { name } = req.query;
      if (!name) {
        return reply.status(400).send({ error: 'name query parameter is required' });
      }
      return { available: this.store.checkNameUnique(name) };
    });
  }

  private registerWebSocket(): void {
    this.fastify.get('/ws', { websocket: true }, (socket) => {
      this.handleConnection(socket);
    });
  }

  private resolveRoomId(idOrName: string): string | undefined {
    // Try direct ID lookup first
    const rooms = this.store.listRooms();
    const byId = rooms.find((r) => r.id === idOrName);
    if (byId) return byId.id;
    // Try name lookup
    const byName = this.store.getRoomByName(idOrName);
    return byName?.id;
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
    // Ensure the room exists in the store (for WebSocket-created rooms, use roomId as name fallback)
    const existing = this.store.listRooms().find((r) => r.id === req.roomId);
    if (!existing) {
      this.store.saveRoom({ id: req.roomId, name: req.roomId });
    }
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

    const delivered = new Set<string>();

    if (fullMsg.to) {
      // Point-to-point
      room.sendTo(fullMsg.to, fullMsg);
      delivered.add(fullMsg.to);
      // Also send back to sender as confirmation
      socket.send(serialize(fullMsg));
      delivered.add(info.agentId);
    } else {
      // Broadcast (including back to sender)
      room.broadcast(fullMsg);
      return;
    }

    // Deliver to additionally mentioned agents who haven't received the message yet
    if (fullMsg.mentions && fullMsg.mentions.length > 0) {
      for (const mentionedId of fullMsg.mentions) {
        if (!delivered.has(mentionedId)) {
          room.sendTo(mentionedId, fullMsg);
          delivered.add(mentionedId);
        }
      }
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
