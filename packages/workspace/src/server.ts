import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import {
  type SkynetMessage,
  type AgentCard,
  type AgentStatus,
  type HumanProfile,
  type JoinRequest,
  type AgentJoinPayload,
  type AgentLeavePayload,
  AgentType,
  MessageType,
  ClientAction,
  createMessage,
  deserialize,
  serialize,
} from '@skynet/protocol';
import { MemberManager } from './member-manager.js';
import type { Store } from './store.js';

export interface SkynetWorkspaceOptions {
  port?: number;
  host?: string;
  store: Store;
}

export class SkynetWorkspace {
  private fastify = Fastify({ logger: true });
  private members = new MemberManager();
  private store: Store;
  private socketAgentMap = new WeakMap<WebSocket, string>();

  constructor(private options: SkynetWorkspaceOptions) {
    this.store = options.store;
  }

  async start(): Promise<void> {
    await this.fastify.register(websocket);

    this.registerHealthRoutes();
    this.registerAgentRoutes();
    this.registerHumanRoutes();
    this.registerMessageRoutes();
    this.registerNameRoutes();
    this.registerWebSocket();

    const port = this.options.port ?? 4117;
    const host = this.options.host ?? '0.0.0.0';
    await this.fastify.listen({ port, host });
  }

  private registerHealthRoutes(): void {
    this.fastify.get('/health', async () => ({ status: 'ok', memberCount: this.members.size }));
  }

  private registerMessageRoutes(): void {
    // Get workspace messages
    this.fastify.get<{ Querystring: { limit?: string; before?: string } }>(
      '/api/messages',
      async (req) => {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
        const before = req.query.before ? parseInt(req.query.before, 10) : undefined;
        return this.store.getMessages(limit, before);
      },
    );

    // Get connected members
    this.fastify.get('/api/members', async () => {
      return this.members.getMembers();
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
        const agent: AgentCard = {
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
        this.handleHeartbeat(socket, envelope.data as { agentId: string; status: AgentStatus });
        break;
      default:
        socket.send(JSON.stringify({ event: 'error', data: { message: `Unknown action: ${envelope.action}` } }));
    }
  }

  private handleJoin(socket: WebSocket, req: JoinRequest): void {
    this.members.join(req.agent, socket);
    this.socketAgentMap.set(socket, req.agent.id);

    // Notify the joining agent of current workspace state
    socket.send(JSON.stringify({
      event: 'workspace.state',
      data: {
        members: this.members.getMembers(),
        recentMessages: this.store.getMessages(50),
      },
    }));

    // Broadcast join to others
    const joinMsg = createMessage({
      type: MessageType.AGENT_JOIN,
      from: req.agent.id,
      to: null,
      payload: { agent: req.agent } satisfies AgentJoinPayload,
    });
    this.store.save(joinMsg);
    this.members.broadcast(joinMsg, req.agent.id);
  }

  private handleSend(socket: WebSocket, msg: SkynetMessage): void {
    const agentId = this.socketAgentMap.get(socket);
    if (!agentId) {
      socket.send(JSON.stringify({ event: 'error', data: { message: 'Not connected to workspace' } }));
      return;
    }

    // Ensure message has proper fields
    const fullMsg = createMessage({
      ...msg,
      from: agentId,
    });

    this.store.save(fullMsg);

    const delivered = new Set<string>();

    if (fullMsg.to) {
      // Point-to-point
      this.members.sendTo(fullMsg.to, fullMsg);
      delivered.add(fullMsg.to);
      // Also send back to sender as confirmation
      socket.send(serialize(fullMsg));
      delivered.add(agentId);
    } else {
      // Broadcast (including back to sender)
      this.members.broadcast(fullMsg);
      return;
    }

    // Deliver to additionally mentioned agents who haven't received the message yet
    if (fullMsg.mentions && fullMsg.mentions.length > 0) {
      for (const mentionedId of fullMsg.mentions) {
        if (!delivered.has(mentionedId)) {
          this.members.sendTo(mentionedId, fullMsg);
          delivered.add(mentionedId);
        }
      }
    }
  }

  private handleHeartbeat(socket: WebSocket, data: { agentId: string; status: AgentStatus }): void {
    const agentId = this.socketAgentMap.get(socket);
    if (!agentId) return;

    this.members.updateStatus(data.agentId, data.status);

    socket.send(JSON.stringify({ event: 'heartbeat.ack', data: { timestamp: Date.now() } }));
  }

  private handleDisconnect(socket: WebSocket): void {
    const agentId = this.socketAgentMap.get(socket);
    if (!agentId) return;

    this.members.leave(agentId);

    const leaveMsg = createMessage({
      type: MessageType.AGENT_LEAVE,
      from: agentId,
      to: null,
      payload: { agentId } satisfies AgentLeavePayload,
    });
    this.store.save(leaveMsg);
    this.members.broadcast(leaveMsg);

    this.socketAgentMap.delete(socket);
  }

  async stop(): Promise<void> {
    await this.fastify.close();
    this.store.close();
  }
}
