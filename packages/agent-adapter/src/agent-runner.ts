import { randomUUID } from 'node:crypto';
import {
  type AgentCard,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type ChatPayload,
  type SkynetMessage,
  type TaskPayload,
  AgentType,
  MessageType,
  extractMentionNames,
} from '@skynet/protocol';
import { SkynetClient, type RoomState } from '@skynet/sdk';
import type { AgentAdapter } from './base-adapter.js';


export interface AgentRunnerOptions {
  serverUrl: string;
  roomId: string;
  adapter: AgentAdapter;
  agentName?: string;
  capabilities?: string[];
  role?: string;
  persona?: string;
  projectRoot?: string;
}

export class AgentRunner {
  private client: SkynetClient;
  private adapter: AgentAdapter;
  private processing = false;
  private messageQueue: SkynetMessage[] = [];
  private memberNames = new Map<string, string>();

  constructor(private options: AgentRunnerOptions) {
    const agentCard: AgentCard = {
      id: randomUUID(),
      name: options.agentName ?? `${options.adapter.name}-${randomUUID().slice(0, 8)}`,
      type: options.adapter.type,
      role: options.role,
      capabilities: options.capabilities ?? ['code-edit', 'code-review'],
      projectRoot: options.projectRoot,
      status: 'idle',
      persona: options.persona,
    };

    this.client = new SkynetClient({
      serverUrl: options.serverUrl,
      agent: agentCard,
      roomId: options.roomId,
    });

    this.adapter = options.adapter;

    // Build system prompt for injection (persona + skynet skill)
    const parts: string[] = [];
    if (options.role) parts.push(`You are a ${options.role}.`);
    if (options.persona) parts.push(options.persona);
    if (parts.length > 0) {
      this.adapter.persona = parts.join('\n\n');
    }

    this.adapter.setRoomId(options.roomId);
  }

  async start(): Promise<RoomState> {
    const state = await this.client.connect();

    // Pass room name to adapter for message context
    this.adapter.roomName = state.roomName;

    // Build initial member name map from room state
    for (const member of state.members) {
      this.memberNames.set(member.id, member.name);
    }

    this.client.on('agent-join', (msg: SkynetMessage) => {
      const payload = msg.payload as AgentJoinPayload;
      this.memberNames.set(payload.agent.id, payload.agent.name);
    });
    this.client.on('agent-leave', (msg: SkynetMessage) => {
      const payload = msg.payload as AgentLeavePayload;
      this.memberNames.delete(payload.agentId);
    });

    this.client.on('chat', (msg: SkynetMessage) => this.enqueue(msg));
    this.client.on('task-assign', (msg: SkynetMessage) => this.enqueue(msg));

    return state;
  }

  async stop(): Promise<void> {
    await this.adapter.dispose();
    await this.client.close();
  }

  get agentId(): string {
    return this.client.agent.id;
  }

  get agentName(): string {
    return this.client.agent.name;
  }

  private enqueue(msg: SkynetMessage): void {
    // Skip messages from self
    if (msg.from === this.client.agent.id) return;

    // When busy and adapter supports fork: handle chat via forked session
    if (
      this.processing &&
      msg.type === MessageType.CHAT &&
      this.adapter.supportsQuickReply()
    ) {
      this.handleForkedReply(msg);
      return;
    }

    this.messageQueue.push(msg);
    this.processQueue();
  }

  private async handleForkedReply(msg: SkynetMessage): Promise<void> {
    const senderName = this.memberNames.get(msg.from) ?? msg.from;
    const text = (msg.payload as ChatPayload).text;
    try {
      const response = await this.adapter.quickReply(
        `Message from ${senderName}: ${text}`,
      );
      if (response) {
        const mentions = this.resolveMentions(response);
        this.client.chat(response, msg.from, mentions.length > 0 ? mentions : undefined);
      }
    } catch (err) {
      // Fork failed — fall back to normal queue so the message is not lost
      console.error('[AgentRunner] Fork reply failed, queueing message:', err);
      this.messageQueue.push(msg);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.client.agent.status = 'busy';

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      try {
        if (msg.type === MessageType.TASK_ASSIGN) {
          await this.handleTask(msg);
        } else {
          const senderName = this.memberNames.get(msg.from) ?? msg.from;
          const response = await this.adapter.handleMessage(msg, senderName);
          if (response) {
            const mentions = this.resolveMentions(response);
            this.client.chat(response, msg.from, mentions.length > 0 ? mentions : undefined);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentRunner] Error processing message from ${msg.from}:`, err);
        this.client.chat(`Error processing message: ${errorMsg}`, msg.from);
      }
    }

    this.client.agent.status = 'idle';
    this.processing = false;
  }

  /** Resolve @name mentions in text to agent IDs (excluding self). */
  private resolveMentions(text: string): string[] {
    const names = extractMentionNames(text);
    if (names.length === 0) return [];
    const selfId = this.client.agent.id;
    const ids: string[] = [];
    for (const name of names) {
      for (const [agentId, agentName] of this.memberNames) {
        if (agentName.toLowerCase() === name && agentId !== selfId) {
          ids.push(agentId);
          break;
        }
      }
    }
    return ids;
  }

  private async handleTask(msg: SkynetMessage): Promise<void> {
    const task = msg.payload as TaskPayload;

    // Acknowledge
    this.client.updateTask(task.taskId, 'in-progress', this.client.agent.id);

    const result = await this.adapter.executeTask(task);

    this.client.reportTaskResult(
      task.taskId,
      result.success,
      result.summary,
      result.filesChanged,
    );
  }
}
