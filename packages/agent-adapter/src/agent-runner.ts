import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { Logger } from '@skynet-ai/logger';
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
} from '@skynet-ai/protocol';

interface MemberInfo {
  name: string;
  type: AgentType;
}
import { SkynetClient, type WorkspaceState } from '@skynet-ai/sdk';
import type { AgentAdapter, SessionState } from './base-adapter.js';
import { buildSkynetIntro } from './skynet-intro.js';

/** Default debounce window (ms) — messages must age this long before processing. */
const DEFAULT_DEBOUNCE_MS = 3000;

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
  /**
   * Debounce window (ms) for collecting chat messages before processing.
   * Each message must have arrived at least this long ago before processing starts.
   * This naturally batches messages that arrive close together.
   * Set to 0 to disable debouncing. Defaults to 3000.
   */
  debounceMs?: number;
}

/** Max number of message IDs to track for deduplication. */
const DEDUP_MAX_SIZE = 500;

/** Pattern matching the `<no-reply />` XML tag. */
const NO_REPLY_PATTERN = /<no-reply\s*\/>/;

/**
 * Check whether the agent's response signals "no reply".
 * If the `<no-reply />` tag appears anywhere in the response, the entire message is suppressed.
 */
export function isNoReply(response: string): boolean {
  return NO_REPLY_PATTERN.test(response);
}

/** A message in the queue with its arrival timestamp. */
interface QueuedMessage {
  msg: SkynetMessage;
  arrivedAt: number;
}

export class AgentRunner {
  private client: SkynetClient;
  private adapter: AgentAdapter;
  private logger: Logger;
  private promptLogStream: WriteStream | null = null;
  private processing = false;
  private forkInProgress = false;
  private messageQueue: QueuedMessage[] = [];
  private memberInfo = new Map<string, MemberInfo>();
  /** Recently processed message IDs to prevent duplicate handling. */
  private processedMessageIds = new Set<string>();
  /** Pending notices (e.g. member join/leave) to piggyback on the next message. */
  private pendingNotices: string[] = [];
  /** Timer for the next processQueue check. */
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(private options: AgentRunnerOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
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

    this.adapter = options.adapter;

    const { lastSeenTimestamp, session } = this.loadPersistedState();

    // Restore adapter session state from a previous run so the agent
    // can resume its Claude Code (or other CLI) conversation context.
    if (session) {
      this.adapter.restoreSessionState(session);
    }

    this.client = new SkynetClient({
      serverUrl: options.serverUrl,
      agent: agentCard,
      lastSeenTimestamp,
    });
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

    // Set up prompt logging to ~/.skynet/<workspace-id>/<agent-id>/prompt.log
    if (options.statePath) {
      const promptLogPath = join(dirname(options.statePath), 'prompt.log');
      const logDir = dirname(promptLogPath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.promptLogStream = createWriteStream(promptLogPath, { flags: 'a' });
      // Prevent uncaught exceptions from stream errors (e.g. directory removed)
      this.promptLogStream.on('error', () => {});
      this.adapter.onPrompt = (prompt, context) => {
        const timestamp = new Date().toISOString();
        const separator = '─'.repeat(60);
        this.promptLogStream?.write(
          `${separator}\n[${timestamp}] type=${context.type}\n${separator}\n${prompt}\n\n`,
        );
      };
    }
  }

  async start(): Promise<WorkspaceState> {
    this.logger.info(`Connecting to ${this.options.serverUrl}`);

    // Ensure the agent is registered in the workspace before connecting via WebSocket.
    // The server rejects JOIN from unregistered agents.
    await this.ensureRegistered();

    // Register event handlers BEFORE connect() to avoid a race condition:
    // agents that join between the server sending workspace.state and the
    // runner registering handlers would otherwise be missed, leaving
    // memberInfo incomplete and breaking @mention resolution.
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
    this.client.on('agent-interrupt', () => this.handleInterrupt());
    this.client.on('agent-forget', () => this.handleForget());

    const state = await this.client.connect();
    this.logger.info(`Connected, ${state.members.length} members online`);

    // Build initial member info map from workspace state.
    // Any agent-join events that arrived during connect() have already been
    // processed by the handler above, so merge rather than overwrite.
    for (const member of state.members) {
      this.memberInfo.set(member.id, { name: member.name, type: member.type });
    }

    // Clear any notices generated during initial connection — the agent already
    // knows the initial member list from workspace state.
    this.pendingNotices = [];

    return state;
  }

  async stop(): Promise<void> {
    this.clearSchedule();
    this.logger.info('Stopping agent');
    await this.adapter.dispose();
    await this.client.close();
    this.logger.close();
    if (this.promptLogStream) {
      this.promptLogStream.end();
      this.promptLogStream = null;
    }
  }

  get agentId(): string {
    return this.client.agent.id;
  }

  /** Update agent status and broadcast via heartbeat. */
  private setStatus(status: import('@skynet-ai/protocol').AgentStatus): void {
    this.client.agent.status = status;
    this.client.sendHeartbeatNow();
  }

  /** Register the agent via HTTP API if it doesn't already exist in the workspace. */
  private async ensureRegistered(): Promise<void> {
    const { serverUrl } = this.options;
    const agent = this.client.agent;
    const url = `${serverUrl}/api/agents/${agent.id}`;

    const check = await fetch(url);
    if (check.ok) return; // Already registered

    const create = await fetch(`${serverUrl}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agent.name,
        type: agent.type,
        role: agent.role,
        persona: agent.persona,
      }),
    });

    if (create.ok) {
      // Server assigned a new ID — update our agent card to match
      const created = await create.json() as AgentCard;
      (this.client.agent as AgentCard).id = created.id;
      this.logger.info(`Auto-registered agent: ${created.name} (${created.id})`);
    } else if (create.status === 409) {
      // Name already taken — look up the existing agent by name and use its ID
      const lookup = await fetch(`${serverUrl}/api/agents/${agent.name}`);
      if (lookup.ok) {
        const existing = await lookup.json() as AgentCard;
        (this.client.agent as AgentCard).id = existing.id;
        this.logger.info(`Using existing agent: ${existing.name} (${existing.id})`);
      }
    } else {
      const body = await create.text();
      throw new Error(`Failed to register agent: ${create.status} ${body}`);
    }
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

    this.messageQueue.push({ msg, arrivedAt: Date.now() });

    // Task messages bypass debounce — process immediately
    if (msg.type === MessageType.TASK_ASSIGN) {
      this.clearSchedule();
      this.processQueue();
      return;
    }

    // When already busy, messages accumulate naturally in the queue;
    // processQueue will reschedule itself after finishing.
    if (this.processing) return;

    this.scheduleProcessQueue();
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
    const payload = msg.payload as ChatPayload;
    const text = payload.text;
    const notices = this.flushNotices();

    // Quick reply is text-only; if the message has image attachments,
    // fall back to the normal queue so handleMessage can pass them to the CLI.
    if (payload.attachments?.some((a) => a.type === 'image')) {
      this.forkInProgress = false;
      this.messageQueue.push({ msg, arrivedAt: Date.now() });
      return;
    }

    try {
      const prompt = notices
        ? `${notices}\n\nMessage from ${senderName}: ${text}`
        : `Message from ${senderName}: ${text}`;
      const response = await this.adapter.quickReply(prompt);
      if (response && !isNoReply(response)) {
        const mentions = this.resolveMentions(response);
        // Always include the original sender in mentions
        if (!mentions.includes(msg.from)) mentions.push(msg.from);
        this.client.chat(response, mentions);
      }
    } catch (err) {
      // Fork failed — fall back to normal queue so the message is not lost
      this.logger.error('Fork reply failed, queueing message:', err);
      this.messageQueue.push({ msg, arrivedAt: Date.now() });
    } finally {
      this.forkInProgress = false;
    }
  }

  /**
   * Schedule processQueue when the newest message in the queue has aged enough.
   * If debounce is disabled, processes immediately.
   */
  private scheduleProcessQueue(): void {
    if (this.debounceMs <= 0) {
      this.processQueue();
      return;
    }
    if (this.messageQueue.length === 0) return;

    // Wait until the newest message has aged at least debounceMs
    const newest = this.messageQueue[this.messageQueue.length - 1];
    const age = Date.now() - newest.arrivedAt;
    const wait = Math.max(0, this.debounceMs - age);

    // Clear any existing timer and set a new one
    this.clearSchedule();
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      this.processQueue();
    }, wait);
  }

  private clearSchedule(): void {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    if (this.messageQueue.length === 0) return;

    // Check if all chat messages have aged enough.
    // Tasks in the queue force immediate processing (no debounce).
    if (this.debounceMs > 0) {
      const hasTask = this.messageQueue.some((qm) => qm.msg.type === MessageType.TASK_ASSIGN);
      if (!hasTask) {
        const now = Date.now();
        const newestChat = this.findNewestChat();
        if (newestChat && (now - newestChat.arrivedAt) < this.debounceMs) {
          this.scheduleProcessQueue();
          return;
        }
      }
    }

    this.processing = true;
    this.setStatus('busy');

    // Process leading tasks
    while (this.messageQueue.length > 0 && this.messageQueue[0].msg.type === MessageType.TASK_ASSIGN) {
      const { msg } = this.messageQueue.shift()!;
      try {
        await this.handleTask(msg);
      } catch (err) {
        this.logger.error(`Error processing task from ${msg.from}:`, err);
        this.setStatus('error');
      }
    }

    // Drain chat messages up to the next task
    const chatBatch: SkynetMessage[] = [];
    while (
      this.messageQueue.length > 0 &&
      this.messageQueue[0].msg.type !== MessageType.TASK_ASSIGN
    ) {
      chatBatch.push(this.messageQueue.shift()!.msg);
    }

    if (chatBatch.length > 0) {
      const notices = this.flushNotices();
      try {
        if (chatBatch.length === 1) {
          const msg = chatBatch[0];
          const senderName = this.memberInfo.get(msg.from)?.name ?? msg.from;
          const response = await this.adapter.handleMessage(msg, senderName, notices || undefined);
          if (response && !isNoReply(response)) {
            const mentions = this.resolveMentions(response);
            if (!mentions.includes(msg.from)) mentions.push(msg.from);
            this.client.chat(response, mentions);
          }
        } else {
          await this.handleBatchMessages(chatBatch, notices);
        }
      } catch (err) {
        this.logger.error('Error processing messages:', err);
        this.setStatus('error');
      }
    }

    this.setStatus('idle');
    this.processing = false;
    this.persistState();

    // If more messages arrived during processing, reschedule
    if (this.messageQueue.length > 0) {
      this.scheduleProcessQueue();
    }
  }

  /** Find the newest chat message in the queue, or undefined if none. */
  private findNewestChat(): QueuedMessage | undefined {
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      if (this.messageQueue[i].msg.type !== MessageType.TASK_ASSIGN) {
        return this.messageQueue[i];
      }
    }
    return undefined;
  }

  /** Batch multiple chat messages into a single adapter call. */
  private async handleBatchMessages(messages: SkynetMessage[], notices = ''): Promise<void> {
    // Build a combined message with all texts
    const lines = messages.map((msg) => {
      const senderName = this.memberInfo.get(msg.from)?.name ?? msg.from;
      const text = (msg.payload as ChatPayload).text;
      return `[${senderName}]: ${text}`;
    });

    // Collect all attachments from the batch
    const allAttachments = messages.flatMap((msg) => (msg.payload as ChatPayload).attachments ?? []);

    // Create a synthetic message for the adapter
    const batchPayload: ChatPayload = {
      text: `You have ${messages.length} unread messages. Please respond to all of them in a single reply:\n\n${lines.join('\n\n')}`,
      ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
    };
    const batchMsg: SkynetMessage = {
      ...messages[0],
      payload: batchPayload,
    };

    const senderName = this.memberInfo.get(messages[0].from)?.name ?? messages[0].from;
    const response = await this.adapter.handleMessage(batchMsg, senderName, notices || undefined);

    if (response && !isNoReply(response)) {
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

  /** Handle an interrupt control message — kill running process and clear queue. */
  private async handleInterrupt(): Promise<void> {
    this.logger.info('Interrupt received');
    this.clearSchedule();
    this.messageQueue = [];
    this.pendingNotices = [];
    const interrupted = await this.adapter.interrupt();
    if (interrupted) {
      this.logger.info('Running process was interrupted');
    }
    // Reset processing state so the agent can accept new messages
    this.processing = false;
    this.forkInProgress = false;
    this.setStatus('idle');
  }

  /** Handle a forget control message — reset session and clear all state. */
  private async handleForget(): Promise<void> {
    this.logger.info('Forget received — resetting session');
    // Interrupt first if busy
    this.clearSchedule();
    this.messageQueue = [];
    this.pendingNotices = [];
    await this.adapter.resetSession();
    this.processedMessageIds.clear();
    this.processing = false;
    this.forkInProgress = false;
    this.setStatus('idle');
  }

  private persistState(): void {
    if (!this.options.statePath) return;
    try {
      const dir = dirname(this.options.statePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data: Record<string, unknown> = {
        lastSeenTimestamp: this.client.lastSeenTimestamp,
      };
      const session = this.adapter.getSessionState();
      if (session) {
        data.session = session;
      }
      writeFileSync(
        this.options.statePath,
        JSON.stringify(data) + '\n',
        'utf-8',
      );
    } catch {
      // Best-effort persistence — don't crash on write failure
    }
  }

  private loadPersistedState(): { lastSeenTimestamp: number; session?: SessionState } {
    if (!this.options.statePath || !existsSync(this.options.statePath)) {
      return { lastSeenTimestamp: 0 };
    }
    try {
      const raw = readFileSync(this.options.statePath, 'utf-8');
      const data = JSON.parse(raw) as { lastSeenTimestamp?: number; session?: SessionState };
      return {
        lastSeenTimestamp: data.lastSeenTimestamp ?? 0,
        session: data.session,
      };
    } catch {
      return { lastSeenTimestamp: 0 };
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
