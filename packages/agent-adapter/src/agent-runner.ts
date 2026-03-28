import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Logger } from '@skynet-ai/logger';
import {
  type AgentCard,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type AgentWatchPayload,
  type AgentUnwatchPayload,
  type ChatPayload,
  type SkynetMessage,
  type TaskPayload,
  AgentType,
  MessageType,
  MENTION_ALL,
} from '@skynet-ai/protocol';

interface MemberInfo {
  name: string;
  type: AgentType;
  role?: string;
}
import { SkynetClient, type WorkspaceState } from '@skynet-ai/sdk';
import type { AgentAdapter, SessionState } from './base-adapter.js';
import { buildSkynetIntro, buildMemberRoster } from './skynet-intro.js';
import { parseScheduleCommands, stripScheduleTags, type ScheduleCommand } from './schedule-parser.js';

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

/**
 * Extract a safe error message from an error, avoiding command-line leaks.
 * Execa errors include the full command in `.message` but provide a shorter
 * `.shortMessage` that omits the command output.  We prefer that, then strip
 * any `Command failed…: <binary> <args>` prefix so adapter internals (flags,
 * system prompts) are never exposed in execution logs.
 */
function sanitizeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // Prefer execa's shortMessage (no stdout/stderr dump)
  const raw: string = (err as unknown as Record<string, unknown>).shortMessage as string ?? err.message;
  // Strip "Command failed with exit code N: <command...>" prefix
  const cmdPrefix = /^Command failed.*?:\s*.+/;
  if (cmdPrefix.test(raw)) {
    const exitCodeMatch = raw.match(/exit code (\d+)/);
    const code = exitCodeMatch ? exitCodeMatch[1] : 'unknown';
    return `Command failed with exit code ${code}`;
  }
  return raw;
}

export class AgentRunner {
  private client: SkynetClient;
  private adapter: AgentAdapter;
  private logger: Logger;
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
  /**
   * Monotonically increasing counter bumped on each forget/reset.
   * processQueue captures the value at start and bails out if it changes,
   * preventing stale post-reset side effects (persistState, reschedule).
   */
  private resetGeneration = 0;
  /** Human IDs subscribed to verbose execution logs via /watch. */
  private verboseSubscribers = new Set<string>();

  /** Base persona text (role + persona + skynet intro) without member roster. */
  private basePersona: string;

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
    this.basePersona = parts.join('\n\n');
    this.adapter.persona = this.basePersona;

    // Log prompts to the agent log for a complete trace
    this.adapter.onPrompt = (prompt, context) => {
      this.logger.info(`[prompt] type=${context.type}\n${prompt}`);
    };

    // Wire execution log callback — always log to agent log, and send via WebSocket when watched
    this.adapter.onExecutionLog = (event, summary, metadata) => {
      // Always write to agent log for a complete execution trace
      const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
      this.logger.debug(`[exec] ${event}: ${summary}${metaStr}`);
      // Send via WebSocket only when humans are watching
      if (this.verboseSubscribers.size === 0) return;
      const mentions = [...this.verboseSubscribers];
      this.client.sendExecutionLog(event, summary, { metadata, mentions });
    };
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
      this.memberInfo.set(payload.agent.id, { name: payload.agent.name, type: payload.agent.type, role: payload.agent.role });
      const roleTag = payload.agent.role ? ` (${payload.agent.role})` : '';
      this.pendingNotices.push(`[System] ${payload.agent.name}${roleTag} has joined the workspace.`);
    });
    this.client.on('agent-leave', (msg: SkynetMessage) => {
      const payload = msg.payload as AgentLeavePayload;
      const info = this.memberInfo.get(payload.agentId);
      const name = info?.name ?? payload.agentId;
      const roleTag = info?.role ? ` (${info.role})` : '';
      this.pendingNotices.push(`[System] ${name}${roleTag} has left the workspace.`);
      this.memberInfo.delete(payload.agentId);
    });

    // Refresh member info on reconnection (but do NOT refresh persona here —
    // changing the system prompt mid-session invalidates the KV cache).
    this.client.on('workspace-state', (ws: WorkspaceState) => {
      this.memberInfo.clear();
      for (const member of ws.members) {
        this.memberInfo.set(member.id, { name: member.name, type: member.type, role: member.role });
      }
    });

    this.client.on('chat', (msg: SkynetMessage) => this.enqueue(msg));
    this.client.on('task-assign', (msg: SkynetMessage) => this.enqueue(msg));
    this.client.on('agent-interrupt', () => this.handleInterrupt());
    this.client.on('agent-forget', () => this.handleForget());
    this.client.on('agent-watch', (msg: SkynetMessage) => this.handleWatch(msg));
    this.client.on('agent-unwatch', (msg: SkynetMessage) => this.handleUnwatch(msg));

    const state = await this.client.connect();
    this.logger.info(`Connected, ${state.members.length} members online`);

    // Build initial member info map from workspace state.
    // Any agent-join events that arrived during connect() have already been
    // processed by the handler above, so merge rather than overwrite.
    for (const member of state.members) {
      this.memberInfo.set(member.id, { name: member.name, type: member.type, role: member.role });
    }

    // Clear any notices generated during initial connection — the agent already
    // knows the initial member list from workspace state.
    this.pendingNotices = [];

    // Inject the current member roster into the system prompt so the agent
    // knows who else is in the workspace and their roles.
    this.refreshPersona();

    return state;
  }

  async stop(): Promise<void> {
    this.clearSchedule();
    this.logger.info('Stopping agent');
    this.client.removeAllListeners();
    await this.adapter.dispose();
    await this.client.close();
    this.logger.close();
  }

  get agentId(): string {
    return this.client.agent.id;
  }

  /** Update agent status and broadcast via heartbeat. */
  private setStatus(status: import('@skynet-ai/protocol').AgentStatus): void {
    this.client.agent.status = status;
    this.client.sendHeartbeatNow();
  }

  /**
   * Rebuild the adapter persona by appending the current member roster
   * to the base persona. Called after connection and after forget/reset
   * so the agent always knows who is in the workspace.
   */
  private refreshPersona(): void {
    const roster = buildMemberRoster(
      this.client.agent.name,
      Array.from(this.memberInfo.values()),
    );
    this.adapter.persona = roster ? `${this.basePersona}\n${roster}` : this.basePersona;
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
      let response = await this.adapter.quickReply(prompt);
      this.logger.info(`[result:quick-reply] ${response ? response.slice(0, 500) : '(empty)'}`);
      if (response) response = await this.processResponse(response);
      if (response && !isNoReply(response)) {
        // Include original sender; server enriches @name mentions from text
        this.client.chat(response, [msg.from]);
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

    // Capture generation so we can detect if a reset (forget) happened mid-flight.
    const gen = this.resetGeneration;

    const startTime = Date.now();
    this.emitWatchLog('processing.start', 'Started processing queue');
    let hadError = false;

    // Process leading tasks
    while (this.messageQueue.length > 0 && this.messageQueue[0].msg.type === MessageType.TASK_ASSIGN) {
      const { msg } = this.messageQueue.shift()!;
      try {
        await this.handleTask(msg);
      } catch (err) {
        this.logger.error(`Error processing task from ${msg.from}:`, err);
        this.emitWatchLog('processing.error', `Task processing failed: ${sanitizeErrorMessage(err)}`, { level: 'error' });
        this.setStatus('error');
        hadError = true;
      }
      // Bail out if a forget/reset happened during the await
      if (this.resetGeneration !== gen) return;
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
          let response = await this.adapter.handleMessage(msg, senderName, notices || undefined);
          this.logger.info(`[result] ${response ? response.slice(0, 500) : '(empty)'}`);
          if (response) response = await this.processResponse(response);
          if (response && !isNoReply(response)) {
            // Include original sender; server enriches @name mentions from text
            this.client.chat(response, [msg.from]);
          }
        } else {
          await this.handleBatchMessages(chatBatch, notices);
        }
      } catch (err) {
        this.logger.error('Error processing messages:', err);
        this.emitWatchLog('processing.error', `Message processing failed: ${sanitizeErrorMessage(err)}`, { level: 'error' });
        this.setStatus('error');
        hadError = true;
      }
    }

    // If a forget/reset happened while we were processing, handleForget already
    // cleaned up all state. Do NOT overwrite with stale status or persistState.
    if (this.resetGeneration !== gen) return;

    if (!hadError) {
      this.emitWatchLog('processing.end', 'Finished processing queue', { durationMs: Date.now() - startTime });
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
    let response = await this.adapter.handleMessage(batchMsg, senderName, notices || undefined);
    this.logger.info(`[result] ${response ? response.slice(0, 500) : '(empty)'}`);
    if (response) response = await this.processResponse(response);

    if (response && !isNoReply(response)) {
      // Include all senders; server enriches @name mentions from text
      const senderIds = [...new Set(messages.map(m => m.from))];
      this.client.chat(response, senderIds);
    }
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
    // Bump generation so any in-flight processQueue bails out after its next await.
    this.resetGeneration++;
    this.clearSchedule();
    this.messageQueue = [];
    this.pendingNotices = [];
    await this.adapter.resetSession();
    this.processedMessageIds.clear();
    this.processing = false;
    this.forkInProgress = false;
    this.setStatus('idle');
    // Re-inject member roster into the fresh session so the agent still
    // knows who is in the workspace and their roles after the reset.
    this.refreshPersona();
    this.persistState();
  }

  /** Handle a watch control message — add human to verbose subscribers. */
  private handleWatch(msg: SkynetMessage): void {
    const payload = msg.payload as AgentWatchPayload;
    this.verboseSubscribers.add(payload.humanId);
    this.logger.info(`Watch enabled by human: ${payload.humanId}`);
  }

  /** Handle an unwatch control message — remove human from verbose subscribers. */
  private handleUnwatch(msg: SkynetMessage): void {
    const payload = msg.payload as AgentUnwatchPayload;
    this.verboseSubscribers.delete(payload.humanId);
    this.logger.info(`Watch disabled by human: ${payload.humanId}`);
  }

  /**
   * Emit an execution log to all current watch subscribers.
   * Checks verboseSubscribers live (not snapshotted) so that /watch
   * enabled mid-execution takes effect immediately.
   */
  private emitWatchLog(event: string, summary: string, options?: Record<string, unknown>): void {
    // Always log to agent log for a complete execution trace
    const logLevel = (options?.level as string) === 'error' ? 'error' : 'info';
    const durationSuffix = options?.durationMs !== undefined ? ` (${options.durationMs}ms)` : '';
    this.logger[logLevel](`[exec] ${event}: ${summary}${durationSuffix}`);

    // Send via WebSocket only when humans are watching
    if (this.verboseSubscribers.size === 0) return;
    const mentions = [...this.verboseSubscribers];
    const { level, durationMs, ...rest } = options ?? {};
    this.client.sendExecutionLog(
      event as import('@skynet-ai/protocol').ExecutionLogEvent,
      summary,
      {
        ...(level ? { level: level as import('@skynet-ai/protocol').ExecutionLogLevel } : {}),
        ...(durationMs !== undefined ? { durationMs: durationMs as number } : {}),
        ...rest,
        mentions,
      },
    );
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

  /**
   * Parse schedule commands from agent response, execute them via SDK,
   * and return the cleaned response text (without schedule tags).
   * Results are fed back to the agent immediately via quickReply so it can
   * act on them (e.g. relay a schedule list or use an ID to delete).
   */
  private async processResponse(response: string): Promise<string> {
    const commands = parseScheduleCommands(response);
    if (commands.length === 0) return response;

    const feedbacks: string[] = [];
    for (const cmd of commands) {
      try {
        const feedback = await this.executeScheduleCommand(cmd);
        if (feedback) feedbacks.push(feedback);
      } catch (err) {
        const errMsg = (err as Error).message;
        this.logger.error(`Schedule command failed: ${errMsg}`);
        feedbacks.push(`[System] Schedule ${cmd.type} failed: ${errMsg}`);
      }
    }

    let cleaned = stripScheduleTags(response);

    // Feed results back to the agent immediately via quickReply
    if (feedbacks.length > 0) {
      const feedbackText = feedbacks.join('\n');
      try {
        const followUp = await this.adapter.quickReply(feedbackText);
        this.logger.info(`[result:schedule-feedback] ${followUp ? followUp.slice(0, 500) : '(empty)'}`);
        if (followUp && !isNoReply(followUp)) {
          // Recursively process in case follow-up contains more schedule tags
          const processedFollowUp = await this.processResponse(followUp);
          if (processedFollowUp) {
            cleaned = cleaned ? `${cleaned}\n\n${processedFollowUp}` : processedFollowUp;
          }
        }
      } catch (err) {
        // quickReply failed — fall back to pendingNotices
        this.logger.error('Schedule feedback quickReply failed, queuing as notice:', err);
        this.pendingNotices.push(...feedbacks);
      }
    }

    return cleaned;
  }

  /**
   * Execute a single schedule command and return a feedback string for the agent.
   */
  private async executeScheduleCommand(cmd: ScheduleCommand): Promise<string | undefined> {
    switch (cmd.type) {
      case 'create': {
        // Resolve @name to agent ID
        const agentId = this.resolveAgentName(cmd.agent);
        if (!agentId) {
          this.logger.warn(`Schedule create: unknown agent '${cmd.agent}'`);
          return `[System] Schedule create failed: unknown agent '${cmd.agent}'`;
        }
        const schedule = await this.client.createSchedule({
          name: cmd.name,
          cronExpr: cmd.cron,
          agentId,
          taskTemplate: { title: cmd.title, description: cmd.description },
          createdBy: this.client.agent.id,
        });
        this.logger.info(`Schedule created: ${schedule.name} (${schedule.id})`);
        return `[System] Schedule created: name="${schedule.name}", id="${schedule.id}", cron="${schedule.cronExpr}"`;
      }
      case 'delete': {
        await this.client.deleteSchedule(cmd.id);
        this.logger.info(`Schedule deleted: ${cmd.id}`);
        return `[System] Schedule deleted: id="${cmd.id}"`;
      }
      case 'list': {
        const schedules = await this.client.listSchedules();
        this.logger.info(`Schedules: ${JSON.stringify(schedules)}`);
        return this.formatScheduleList(schedules);
      }
    }
  }

  /** Format a schedule list into a readable system notice for the agent. */
  private formatScheduleList(schedules: import('@skynet-ai/protocol').ScheduleInfo[]): string {
    if (schedules.length === 0) {
      return '[System] No schedules found.';
    }
    const lines = schedules.map((s) => {
      const agentName = this.resolveAgentId(s.agentId) ?? s.agentId;
      const status = s.enabled ? 'enabled' : 'disabled';
      return `- id="${s.id}" name="${s.name}" cron="${s.cronExpr}" agent="@${agentName}" status=${status} title="${s.taskTemplate.title}"`;
    });
    return `[System] Schedules (${schedules.length}):\n${lines.join('\n')}`;
  }

  /** Resolve an agent ID back to its name. */
  private resolveAgentId(agentId: string): string | undefined {
    if (agentId === this.client.agent.id) return this.client.agent.name;
    return this.memberInfo.get(agentId)?.name;
  }

  /** Resolve an agent name to its ID from the member info map. */
  private resolveAgentName(name: string): string | undefined {
    // Check if it's already the agent's own name
    if (name === this.client.agent.name) return this.client.agent.id;
    for (const [id, info] of this.memberInfo) {
      if (info.name === name) return id;
    }
    return undefined;
  }

  private async handleTask(msg: SkynetMessage): Promise<void> {
    const task = msg.payload as TaskPayload;

    // Acknowledge
    this.client.updateTask(task.taskId, 'in-progress', this.client.agent.id);

    const result = await this.adapter.executeTask(task);
    this.logger.info(`[result:task] success=${result.success} ${result.summary.slice(0, 500)}`);

    this.client.reportTaskResult(
      task.taskId,
      result.success,
      result.summary,
      result.filesChanged,
    );
  }
}
