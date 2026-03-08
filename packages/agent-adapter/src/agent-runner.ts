import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Logger } from '@skynet/logger';
import {
  type AgentCard,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type ChatPayload,
  type SkynetMessage,
  type TaskPayload,
  AgentType,
  MessageType,
  MENTION_ALL,
  extractMentionNames,
} from '@skynet/protocol';

interface MemberInfo {
  name: string;
  type: AgentType;
}
import { SkynetClient, type WorkspaceState } from '@skynet/sdk';
import type { AgentAdapter } from './base-adapter.js';
import { buildSkynetIntro } from './skynet-intro.js';

export interface AgentRunnerOptions {
  serverUrl: string;
  adapter: AgentAdapter;
  agentId?: string;
  agentName?: string;
  capabilities?: string[];
  role?: string;
  persona?: string;
  projectRoot?: string;
  /** Path to a JSON file for persisting agent state (e.g. lastSeenTimestamp). */
  statePath?: string;
  /** Log file path. When set, agent logs are written to this file. */
  logFile?: string;
}

/** Max number of message IDs to track for deduplication. */
const DEDUP_MAX_SIZE = 500;

/** Sentinel value returned by agents when they choose not to reply. */
export const NO_REPLY = 'NO_REPLY';

export class AgentRunner {
  private client: SkynetClient;
  private adapter: AgentAdapter;
  private logger: Logger;
  private processing = false;
  private forkInProgress = false;
  private messageQueue: SkynetMessage[] = [];
  private memberInfo = new Map<string, MemberInfo>();
  /** Recently processed message IDs to prevent duplicate handling. */
  private processedMessageIds = new Set<string>();
  /** Pending notices (e.g. member join/leave) to piggyback on the next message. */
  private pendingNotices: string[] = [];

  constructor(private options: AgentRunnerOptions) {
    const agentCard: AgentCard = {
      id: options.agentId ?? randomUUID(),
      name: options.agentName ?? `${options.adapter.name}-${randomUUID().slice(0, 8)}`,
      type: options.adapter.type,
      role: options.role,
      capabilities: options.capabilities ?? ['code-edit', 'code-review'],
      projectRoot: options.projectRoot,
      status: 'idle',
      persona: options.persona,
    };

    const lastSeenTimestamp = this.loadLastSeenTimestamp();

    this.client = new SkynetClient({
      serverUrl: options.serverUrl,
      agent: agentCard,
      lastSeenTimestamp,
    });

    this.adapter = options.adapter;
    this.logger = new Logger(`agent:${agentCard.name}`, {
      filePath: options.logFile,
      level: 'debug',
      console: false,
    });

    // Build system prompt for injection (persona + skynet identity & rules)
    const parts: string[] = [];
    if (options.role) parts.push(`You are a ${options.role}.`);
    if (options.persona) parts.push(options.persona);
    parts.push(buildSkynetIntro(agentCard.name));
    this.adapter.persona = parts.join('\n\n');
  }

  async start(): Promise<WorkspaceState> {
    this.logger.info(`Connecting to ${this.options.serverUrl}`);
    const state = await this.client.connect();
    this.logger.info(`Connected, ${state.members.length} members online`);

    // Build initial member info map from workspace state
    for (const member of state.members) {
      this.memberInfo.set(member.id, { name: member.name, type: member.type });
    }

    this.client.on('agent-join', (msg: SkynetMessage) => {
      const payload = msg.payload as AgentJoinPayload;
      this.memberInfo.set(payload.agent.id, { name: payload.agent.name, type: payload.agent.type });
      this.pendingNotices.push(`[System] ${payload.agent.name} has joined the workspace.`);
    });
    this.client.on('agent-leave', (msg: SkynetMessage) => {
      const payload = msg.payload as AgentLeavePayload;
      const info = this.memberInfo.get(payload.agentId);
      const name = info?.name ?? payload.agentId;
      this.pendingNotices.push(`[System] ${name} has left the workspace.`);
      this.memberInfo.delete(payload.agentId);
    });

    // Refresh member info on reconnection
    this.client.on('workspace-state', (ws: WorkspaceState) => {
      this.memberInfo.clear();
      for (const member of ws.members) {
        this.memberInfo.set(member.id, { name: member.name, type: member.type });
      }
    });

    this.client.on('chat', (msg: SkynetMessage) => this.enqueue(msg));
    this.client.on('task-assign', (msg: SkynetMessage) => this.enqueue(msg));

    // Clear any notices generated during initial connection — the agent already
    // knows the initial member list from workspace state.
    this.pendingNotices = [];

    return state;
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping agent');
    await this.adapter.dispose();
    await this.client.close();
    this.logger.close();
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

    // Deduplicate: skip already-processed messages
    if (this.processedMessageIds.has(msg.id)) return;
    this.trackMessageId(msg.id);

    // Only process messages that mention this agent (or @all)
    if (msg.type === MessageType.CHAT && !this.isMessageForMe(msg)) return;

    // When busy: only fork for chat messages from humans, max 1 concurrent fork.
    // Agent-to-agent messages are queued and batched to avoid duplicate responses.
    const senderInfo = this.memberInfo.get(msg.from);
    const isHumanSender = senderInfo?.type === AgentType.HUMAN;
    if (
      this.processing &&
      msg.type === MessageType.CHAT &&
      isHumanSender &&
      this.adapter.supportsQuickReply() &&
      !this.forkInProgress
    ) {
      this.handleForkedReply(msg);
      return;
    }

    this.messageQueue.push(msg);
    this.processQueue();
  }

  /** Drain pending notices and return them as a single prefix string, or empty. */
  private flushNotices(): string {
    if (this.pendingNotices.length === 0) return '';
    const text = this.pendingNotices.join('\n');
    this.pendingNotices = [];
    return text;
  }

  /** Check if this agent is @mentioned (directly or via @all). */
  private isMessageForMe(msg: SkynetMessage): boolean {
    if (!msg.mentions || msg.mentions.length === 0) return false;
    if (msg.mentions.includes(MENTION_ALL)) return true;
    return msg.mentions.includes(this.client.agent.id);
  }

  /** Track a message ID, evicting old entries when the set gets too large. */
  private trackMessageId(id: string): void {
    this.processedMessageIds.add(id);
    if (this.processedMessageIds.size > DEDUP_MAX_SIZE) {
      // Remove the oldest entry (first inserted)
      const first = this.processedMessageIds.values().next().value;
      if (first !== undefined) {
        this.processedMessageIds.delete(first);
      }
    }
  }

  private async handleForkedReply(msg: SkynetMessage): Promise<void> {
    this.forkInProgress = true;
    const senderName = this.memberInfo.get(msg.from)?.name ?? msg.from;
    const text = (msg.payload as ChatPayload).text;
    const notices = this.flushNotices();
    try {
      const prompt = notices
        ? `${notices}\n\nMessage from ${senderName}: ${text}`
        : `Message from ${senderName}: ${text}`;
      const response = await this.adapter.quickReply(prompt);
      if (response && response.trim() !== NO_REPLY) {
        const mentions = this.resolveMentions(response);
        // Always include the original sender in mentions
        if (!mentions.includes(msg.from)) mentions.push(msg.from);
        this.client.chat(response, mentions);
      }
    } catch (err) {
      // Fork failed — fall back to normal queue so the message is not lost
      this.logger.error('Fork reply failed, queueing message:', err);
      this.messageQueue.push(msg);
    } finally {
      this.forkInProgress = false;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.client.agent.status = 'busy';
    this.client.setTyping(true);

    while (this.messageQueue.length > 0) {
      // Peek at first message — tasks are always processed individually
      if (this.messageQueue[0].type === MessageType.TASK_ASSIGN) {
        const msg = this.messageQueue.shift()!;
        try {
          await this.handleTask(msg);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Error processing task from ${msg.from}:`, err);
          this.client.chat(`Error processing task: ${errorMsg}`, [msg.from]);
        }
        continue;
      }

      // Drain all leading chat messages and batch them
      const chatBatch: SkynetMessage[] = [];
      while (
        this.messageQueue.length > 0 &&
        (this.messageQueue[0].type as string) !== MessageType.TASK_ASSIGN
      ) {
        chatBatch.push(this.messageQueue.shift()!);
      }

      if (chatBatch.length === 0) continue;

      const notices = this.flushNotices();
      try {
        if (chatBatch.length === 1) {
          // Single message — process normally
          const msg = chatBatch[0];
          const senderName = this.memberInfo.get(msg.from)?.name ?? msg.from;
          const msgToSend = notices
            ? { ...msg, payload: { text: `${notices}\n\n${(msg.payload as ChatPayload).text}` } as ChatPayload }
            : msg;
          const response = await this.adapter.handleMessage(msgToSend, senderName);
          if (response && response.trim() !== NO_REPLY) {
            const mentions = this.resolveMentions(response);
            // Always include the original sender in mentions
            if (!mentions.includes(msg.from)) mentions.push(msg.from);
            this.client.chat(response, mentions);
          }
        } else {
          // Multiple messages — batch into a single prompt
          await this.handleBatchMessages(chatBatch, notices);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('Error processing messages:', err);
        this.client.chat(`Error processing messages: ${errorMsg}`, [chatBatch[0].from]);
      }
    }

    this.client.setTyping(false);
    this.client.agent.status = 'idle';
    this.processing = false;
    this.persistLastSeenTimestamp();
  }

  /** Batch multiple chat messages into a single adapter call. */
  private async handleBatchMessages(messages: SkynetMessage[], notices = ''): Promise<void> {
    // Build a combined message with all texts
    const lines = messages.map((msg) => {
      const senderName = this.memberInfo.get(msg.from)?.name ?? msg.from;
      const text = (msg.payload as ChatPayload).text;
      return `[${senderName}]: ${text}`;
    });

    const prefix = notices ? `${notices}\n\n` : '';

    // Create a synthetic message for the adapter
    const batchMsg: SkynetMessage = {
      ...messages[0],
      payload: {
        text: `${prefix}You have ${messages.length} unread messages. Please respond to all of them in a single reply:\n\n${lines.join('\n\n')}`,
      },
    };

    const senderName = this.memberInfo.get(messages[0].from)?.name ?? messages[0].from;
    const response = await this.adapter.handleMessage(batchMsg, senderName);

    if (response && response.trim() !== NO_REPLY) {
      const mentions = this.resolveMentions(response);
      // Include all senders in mentions
      for (const m of messages) {
        if (!mentions.includes(m.from)) mentions.push(m.from);
      }
      this.client.chat(response, mentions);
    }
  }

  /** Resolve @name mentions in text to agent IDs (excluding self). @all maps to MENTION_ALL. */
  private resolveMentions(text: string): string[] {
    const names = extractMentionNames(text);
    if (names.length === 0) return [];
    const selfId = this.client.agent.id;
    const ids: string[] = [];
    for (const name of names) {
      if (name === 'all') {
        ids.push(MENTION_ALL);
        continue;
      }
      for (const [agentId, info] of this.memberInfo) {
        if (info.name.toLowerCase() === name && agentId !== selfId) {
          ids.push(agentId);
          break;
        }
      }
    }
    return ids;
  }

  private persistLastSeenTimestamp(): void {
    if (!this.options.statePath) return;
    try {
      const dir = dirname(this.options.statePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        this.options.statePath,
        JSON.stringify({ lastSeenTimestamp: this.client.lastSeenTimestamp }) + '\n',
        'utf-8',
      );
    } catch {
      // Best-effort persistence — don't crash on write failure
    }
  }

  private loadLastSeenTimestamp(): number {
    if (!this.options.statePath || !existsSync(this.options.statePath)) return 0;
    try {
      const raw = readFileSync(this.options.statePath, 'utf-8');
      const data = JSON.parse(raw) as { lastSeenTimestamp?: number };
      return data.lastSeenTimestamp ?? 0;
    } catch {
      return 0;
    }
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
