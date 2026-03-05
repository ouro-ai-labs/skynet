import { randomUUID } from 'node:crypto';
import {
  type AgentCard,
  type SkynetMessage,
  type TaskPayload,
  AgentType,
  MessageType,
} from '@skynet/protocol';
import { SkynetClient, type RoomState } from '@skynet/sdk';
import type { AgentAdapter } from './base-adapter.js';

export interface AgentRunnerOptions {
  serverUrl: string;
  roomId: string;
  adapter: AgentAdapter;
  agentName?: string;
  capabilities?: string[];
  persona?: string;
  projectRoot?: string;
}

export class AgentRunner {
  private client: SkynetClient;
  private adapter: AgentAdapter;
  private processing = false;
  private messageQueue: SkynetMessage[] = [];

  constructor(private options: AgentRunnerOptions) {
    const agentCard: AgentCard = {
      agentId: randomUUID(),
      name: options.agentName ?? `${options.adapter.name}-${randomUUID().slice(0, 8)}`,
      type: options.adapter.type,
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
  }

  async start(): Promise<RoomState> {
    const state = await this.client.connect();

    this.client.on('chat', (msg: SkynetMessage) => this.enqueue(msg));
    this.client.on('task-assign', (msg: SkynetMessage) => this.enqueue(msg));

    return state;
  }

  async stop(): Promise<void> {
    await this.adapter.dispose();
    await this.client.close();
  }

  get agentId(): string {
    return this.client.agent.agentId;
  }

  get agentName(): string {
    return this.client.agent.name;
  }

  private enqueue(msg: SkynetMessage): void {
    // Skip messages from self
    if (msg.from === this.client.agent.agentId) return;

    this.messageQueue.push(msg);
    this.processQueue();
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
          const response = await this.adapter.handleMessage(msg);
          if (response) {
            this.client.chat(response, msg.from);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.client.chat(`Error processing message: ${errorMsg}`, msg.from);
      }
    }

    this.client.agent.status = 'idle';
    this.processing = false;
  }

  private async handleTask(msg: SkynetMessage): Promise<void> {
    const task = msg.payload as TaskPayload;

    // Acknowledge
    this.client.updateTask(task.taskId, 'in-progress', this.client.agent.agentId);

    const result = await this.adapter.executeTask(task);

    this.client.reportTaskResult(
      task.taskId,
      result.success,
      result.summary,
      result.filesChanged,
    );
  }
}
