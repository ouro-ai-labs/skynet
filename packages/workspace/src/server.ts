import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import { Logger } from '@skynet-ai/logger';
import {
  type SkynetMessage,
  type AgentCard,
  type AgentStatus,
  type HumanProfile,
  type JoinRequest,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type AgentInterruptPayload,
  type AgentForgetPayload,
  AgentType,
  MessageType,
  ClientAction,
  MENTION_ALL,
  WS_CLOSE_REPLACED,
  createMessage,
  deserialize,
  serialize,
} from '@skynet-ai/protocol';
import { MemberManager } from './member-manager.js';
import type { Store } from './store.js';

export interface SkynetWorkspaceOptions {
  port?: number;
  host?: string;
  store: Store;
  /** Grace period (ms) before broadcasting AGENT_LEAVE after socket close. Default: 300000 (5 minutes). */
  disconnectGraceMs?: number;
  /** Max number of recent mentioned/DM messages for agents in workspace.state. Default: 3. Humans always receive up to 100. */
  recentMentionsLimit?: number;
  /** Log file path. When set, server logs are written to this file. */
  logFile?: string;
}

export class SkynetWorkspace {
  private fastify = Fastify({ logger: true });
  private members = new MemberManager();
  private store: Store;
  private logger: Logger;
  private socketAgentMap = new WeakMap<WebSocket, string>();
  /** Pending leave timers — cancelled if agent reconnects within grace period. */
  private pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disconnectGraceMs: number;
  private readonly recentMentionsLimit: number;
  private _stopping = false;

  constructor(private options: SkynetWorkspaceOptions) {
    this.store = options.store;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 300000;
    this.recentMentionsLimit = options.recentMentionsLimit ?? 3;
    this.logger = new Logger('workspace', {
      filePath: options.logFile,
      level: 'debug',
      console: false,
    });
  }

  async start(): Promise<void> {
    await this.fastify.register(websocket);

    this.registerHealthRoutes();
    this.registerAgentRoutes();
    this.registerAgentControlRoutes();
    this.registerHumanRoutes();
    this.registerMessageRoutes();
    this.registerNameRoutes();
    this.registerWebSocket();

    const port = this.options.port ?? 4117;
    const host = this.options.host ?? '0.0.0.0';
    await this.fastify.listen({ port, host });
    this.logger.info(`Server started on ${host}:${port}`);
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
          status: 'offline',
        };
        this.store.saveAgent(agent);
        return reply.status(201).send(agent);
      },
    );

    // List agents (merge runtime status from connected members)
    this.fastify.get('/api/agents', async () => {
      const agents = this.store.listAgents();
      return agents.map((a) => {
        const status = this.members.getStatus(a.id);
        return { ...a, status: status ?? a.status };
      });
    });

    // Get agent by ID or name
    this.fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
      const agent = this.store.getAgent(req.params.id);
      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      return agent;
    });

    // Delete agent by UUID
    this.fastify.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
      const agent = this.store.getAgent(req.params.id);
      if (!agent || agent.id !== req.params.id) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      if (this.members.getMember(agent.id)) {
        return reply.status(409).send({ error: 'Agent is currently connected. Disconnect it first.' });
      }
      this.store.deleteAgent(agent.id);
      return reply.status(200).send({ deleted: agent });
    });
  }

  private registerAgentControlRoutes(): void {
    // Interrupt agent — cancel its current task/processing
    this.fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
      '/api/agents/:id/interrupt',
      async (req, reply) => {
        const agent = this.store.getAgent(req.params.id);
        if (!agent) {
          return reply.status(404).send({ error: 'Agent not found' });
        }
        const member = this.members.getMember(agent.id);
        if (!member) {
          return reply.status(409).send({ error: 'Agent is not connected' });
        }
        const msg = createMessage({
          type: MessageType.AGENT_INTERRUPT,
          from: agent.id,
          payload: { agentId: agent.id, reason: req.body?.reason } satisfies AgentInterruptPayload,
          mentions: [agent.id],
        });
        this.members.sendTo(agent.id, msg);
        this.logger.info(`Interrupt sent to agent: ${agent.name} (${agent.id})`);
        return { ok: true, agentId: agent.id };
      },
    );

    // Forget agent conversation — clear its context/session
    this.fastify.post<{ Params: { id: string } }>(
      '/api/agents/:id/forget',
      async (req, reply) => {
        const agent = this.store.getAgent(req.params.id);
        if (!agent) {
          return reply.status(404).send({ error: 'Agent not found' });
        }
        const member = this.members.getMember(agent.id);
        if (!member) {
          return reply.status(409).send({ error: 'Agent is not connected' });
        }
        const msg = createMessage({
          type: MessageType.AGENT_FORGET,
          from: agent.id,
          payload: { agentId: agent.id } satisfies AgentForgetPayload,
          mentions: [agent.id],
        });
        this.members.sendTo(agent.id, msg);
        this.logger.info(`Forget sent to agent: ${agent.name} (${agent.id})`);
        return { ok: true, agentId: agent.id };
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

    // Delete human by UUID
    this.fastify.delete<{ Params: { id: string } }>('/api/humans/:id', async (req, reply) => {
      const human = this.store.getHuman(req.params.id);
      if (!human || human.id !== req.params.id) {
        return reply.status(404).send({ error: 'Human not found' });
      }
      if (this.members.getMember(human.id)) {
        return reply.status(409).send({ error: 'Human is currently connected. Disconnect first.' });
      }
      this.store.deleteHuman(human.id);
      return reply.status(200).send({ deleted: human });
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
        this.logger.warn('Invalid message from client', err);
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
        this.handleExplicitLeave(socket);
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
    const agentId = req.agent.id;

    // Validate that the agent/human is registered in this workspace's store.
    // This prevents stale agents from a previous workspace (same port, different DB) from joining.
    const isHuman = req.agent.type === AgentType.HUMAN;
    const registered = isHuman
      ? this.store.getHuman(agentId)
      : this.store.getAgent(agentId);
    if (!registered) {
      this.logger.warn(`Rejected unregistered ${isHuman ? 'human' : 'agent'}: ${req.agent.name} (${agentId})`);
      socket.send(JSON.stringify({
        event: 'error',
        data: { message: `Unknown ${isHuman ? 'human' : 'agent'} ID. Register via the HTTP API first.` },
      }));
      socket.close();
      return;
    }

    // Check if this is a reconnection (agent already known or has a pending leave)
    const pendingLeave = this.pendingLeaves.get(agentId);
    const existingMember = this.members.getMember(agentId);
    const isReconnect = !!pendingLeave || !!existingMember;

    // Cancel any pending leave timer — agent is back
    if (pendingLeave) {
      clearTimeout(pendingLeave);
      this.pendingLeaves.delete(agentId);
    }

    // Register the new socket FIRST, so any async close-event from the old socket
    // sees the updated member and skips the leave logic.
    this.members.join(req.agent, socket);
    this.socketAgentMap.set(socket, agentId);

    // Close the old socket AFTER registration (prevent ghost connections)
    if (existingMember && existingMember.socket !== socket) {
      // Remove old socket from map so its close handler finds no agentId and exits early
      this.socketAgentMap.delete(existingMember.socket);
      if (existingMember.socket.readyState === existingMember.socket.OPEN) {
        existingMember.socket.close(WS_CLOSE_REPLACED, 'replaced');
      }
    }
    this.logger.info(`Agent joined: ${req.agent.name} (${agentId})${isReconnect ? ' [reconnect]' : ''}`);

    // Always send workspace state to the (re)connecting agent.
    // Humans see all messages; agents only see messages mentioning them.
    const since = req.lastSeenTimestamp;
    const humanHistoryLimit = 100;
    const recentMessages = isHuman
      ? this.store.getMessages(humanHistoryLimit, undefined, since)
      : this.store.getMessagesFor(agentId, this.recentMentionsLimit, since);
    socket.send(JSON.stringify({
      event: 'workspace.state',
      data: {
        members: this.members.getMembers(),
        recentMessages,
      },
    }));

    // Only broadcast join to others for genuinely new members
    if (!isReconnect) {
      const joinMsg = createMessage({
        type: MessageType.AGENT_JOIN,
        from: agentId,
        payload: { agent: req.agent } satisfies AgentJoinPayload,
      });
      this.store.save(joinMsg);
      this.members.broadcast(joinMsg, agentId);
    }
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
    this.logger.debug(`Message from=${agentId} type=${fullMsg.type}`);

    // Routing is driven entirely by mentions.
    // @all → broadcast to all members; otherwise deliver only to mentioned members + echo to sender.
    if (fullMsg.mentions && fullMsg.mentions.includes(MENTION_ALL)) {
      this.members.broadcast(fullMsg);
      return;
    }

    const delivered = new Set<string>();
    // Echo back to sender
    socket.send(serialize(fullMsg));
    delivered.add(agentId);

    if (fullMsg.mentions && fullMsg.mentions.length > 0) {
      for (const mentionedId of fullMsg.mentions) {
        if (!delivered.has(mentionedId)) {
          this.members.sendTo(mentionedId, fullMsg);
          delivered.add(mentionedId);
        }
      }
    }

    // Humans observe all messages — deliver to connected humans not already reached.
    this.members.sendToHumans(fullMsg, delivered);
  }

  private handleHeartbeat(socket: WebSocket, data: { agentId: string; status: AgentStatus }): void {
    const agentId = this.socketAgentMap.get(socket);
    if (!agentId) return;

    const prevStatus = this.members.getStatus(agentId);
    this.members.updateStatus(data.agentId, data.status);

    // Broadcast status change to all other members so UIs can show "thinking..."
    if (prevStatus !== data.status) {
      const event = JSON.stringify({
        event: 'status-change',
        data: { agentId, status: data.status },
      });
      this.members.broadcastRaw(event, agentId);
    }

    socket.send(JSON.stringify({ event: 'heartbeat.ack', data: { timestamp: Date.now() } }));
  }

  /** Explicit LEAVE action — immediate departure, no grace period. */
  private handleExplicitLeave(socket: WebSocket): void {
    const agentId = this.socketAgentMap.get(socket);
    if (!agentId) return;

    // Cancel any pending grace-period leave
    const pending = this.pendingLeaves.get(agentId);
    if (pending) {
      clearTimeout(pending);
      this.pendingLeaves.delete(agentId);
    }

    this.socketAgentMap.delete(socket);
    // Force leave — skip socket readyState check since this is intentional
    this.commitLeave(agentId, true);
  }

  /** Socket close — deferred departure with grace period for reconnection. */
  private handleDisconnect(socket: WebSocket): void {
    const agentId = this.socketAgentMap.get(socket);
    if (!agentId) return;

    this.socketAgentMap.delete(socket);

    // During shutdown, skip grace period entirely — server is closing
    if (this._stopping) return;

    // Check if the member's current socket matches this one.
    // If a reconnection already replaced the socket, skip the leave entirely.
    const current = this.members.getMember(agentId);
    if (current && current.socket !== socket) {
      return;
    }

    // Defer the actual leave to allow reconnection within the grace period
    if (!this.pendingLeaves.has(agentId)) {
      this.pendingLeaves.set(
        agentId,
        setTimeout(() => {
          this.pendingLeaves.delete(agentId);
          this.commitLeave(agentId);
        }, this.disconnectGraceMs),
      );
    }
  }

  /** Actually remove the member and broadcast AGENT_LEAVE. */
  private commitLeave(agentId: string, force = false): void {
    // Double-check the agent hasn't reconnected while the timer was pending
    if (!force) {
      const member = this.members.getMember(agentId);
      if (member && member.socket.readyState === member.socket.OPEN) {
        return;
      }
    }

    this.members.leave(agentId);
    this.logger.info(`Agent left: ${agentId}${force ? ' [explicit]' : ' [grace timeout]'}`);

    const leaveMsg = createMessage({
      type: MessageType.AGENT_LEAVE,
      from: agentId,
      payload: { agentId } satisfies AgentLeavePayload,
    });
    this.store.save(leaveMsg);
    this.members.broadcast(leaveMsg);
  }

  async stop(): Promise<void> {
    this._stopping = true;
    for (const timer of this.pendingLeaves.values()) {
      clearTimeout(timer);
    }
    this.pendingLeaves.clear();
    await this.fastify.close();
    this.store.close();
    this.logger.info('Server stopped');
    this.logger.close();
  }
}
