import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { MessageType, MENTION_ALL } from '@skynet-ai/protocol';
import type { SkynetMessage, AgentCard, TaskPayload } from '@skynet-ai/protocol';
import { AgentRunner, isNoReply } from '../agent-runner.js';
import { AgentAdapter, type TaskResult, type SessionState } from '../base-adapter.js';
import { AgentType } from '@skynet-ai/protocol';
import { buildSkynetIntro, buildMemberRoster } from '../skynet-intro.js';

// ── Mocks ──

// Mock fetch for agent registration — return "already registered" (200 OK)
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({}),
}));

vi.mock('@skynet-ai/sdk', () => {
  const EventEmitter = require('node:events').EventEmitter;

  class MockSkynetClient extends EventEmitter {
    agent: AgentCard;
    chatCalls: Array<{ text: string; mentions?: string[] }> = [];
    lastSeenTimestamp = 0;

    constructor(options: { agent: AgentCard; lastSeenTimestamp?: number }) {
      super();
      this.agent = options.agent;
      this.lastSeenTimestamp = options.lastSeenTimestamp ?? 0;
    }

    /** Optional callback invoked during connect(), before the promise resolves. */
    onConnecting: (() => void) | null = null;

    async connect() {
      if (this.onConnecting) this.onConnecting();
      return { members: [], recentMessages: [] };
    }

    async close() {}

    chat(text: string, mentions?: string[]) {
      this.chatCalls.push({ text, mentions });
    }

    sendMessage() {}
    sendHeartbeatNow() {}
    executionLogCalls: Array<{ event: string; summary: string; options?: Record<string, unknown> }> = [];
    sendExecutionLog(event: string, summary: string, options?: Record<string, unknown>) {
      this.executionLogCalls.push({ event, summary, options });
    }
    updateTask() {}
    reportTaskResult() {}

    // Schedule mocks
    schedulesStore: Array<Record<string, unknown>> = [];
    createScheduleCalls: Array<Record<string, unknown>> = [];
    deleteScheduleCalls: string[] = [];
    listSchedulesCalls = 0;

    async createSchedule(payload: Record<string, unknown>) {
      this.createScheduleCalls.push(payload);
      const schedule = {
        id: `sched-${Math.random().toString(36).slice(2)}`,
        name: payload.name,
        cronExpr: payload.cronExpr,
        agentId: payload.agentId,
        taskTemplate: payload.taskTemplate,
        enabled: true,
        createdBy: payload.createdBy,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.schedulesStore.push(schedule);
      return schedule;
    }

    async deleteSchedule(id: string) {
      this.deleteScheduleCalls.push(id);
      this.schedulesStore = this.schedulesStore.filter((s) => s.id !== id);
      return { deleted: true };
    }

    async listSchedules() {
      this.listSchedulesCalls++;
      return this.schedulesStore;
    }
  }

  return { SkynetClient: MockSkynetClient };
});

// ── Helpers ──

function makeChatMsg(overrides: Partial<{ from: string; text: string; mentions: string[] }> = {}): SkynetMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    type: MessageType.CHAT,
    from: overrides.from ?? 'human-1',
    timestamp: Date.now(),
    payload: { text: overrides.text ?? 'hello' },
    ...(overrides.mentions ? { mentions: overrides.mentions } : {}),
  };
}

function makeTaskMsg(from = 'coordinator-1'): SkynetMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    type: MessageType.TASK_ASSIGN,
    from,
    timestamp: Date.now(),
    payload: {
      taskId: 'task-1',
      title: 'Fix bug',
      description: 'Fix the bug in foo.ts',
      status: 'pending',
    } satisfies TaskPayload,
  };
}

class FakeAdapter extends AgentAdapter {
  readonly type = AgentType.CLAUDE_CODE;
  readonly name = 'fake';

  handleDelay = 0;
  handleResponse = 'handled';
  quickReplyResponse = 'quick reply';
  private _supportsQuickReply = false;
  private _sessionState: SessionState | undefined;

  quickReplyCalls: string[] = [];
  handleMessageCalls: SkynetMessage[] = [];
  handleMessageNotices: (string | undefined)[] = [];
  restoredSessionState: SessionState | undefined;
  resetSessionCalls = 0;

  setSupportsQuickReply(v: boolean) {
    this._supportsQuickReply = v;
  }

  override supportsQuickReply(): boolean {
    return this._supportsQuickReply;
  }

  override async quickReply(prompt: string): Promise<string> {
    this.quickReplyCalls.push(prompt);
    return this.quickReplyResponse;
  }

  override getSessionState(): SessionState | undefined {
    return this._sessionState;
  }

  override restoreSessionState(state: SessionState): void {
    this._sessionState = state;
    this.restoredSessionState = state;
  }

  setSessionState(state: SessionState): void {
    this._sessionState = state;
  }

  async isAvailable() { return true; }

  async handleMessage(msg: SkynetMessage, _senderName?: string, notices?: string): Promise<string> {
    this.handleMessageCalls.push(msg);
    this.handleMessageNotices.push(notices);
    if (this.handleDelay > 0) {
      await new Promise(r => setTimeout(r, this.handleDelay));
    }
    return this.handleResponse;
  }

  async executeTask(): Promise<TaskResult> {
    if (this.handleDelay > 0) {
      await new Promise(r => setTimeout(r, this.handleDelay));
    }
    return { success: true, summary: 'done' };
  }

  async dispose() {}

  override async resetSession(): Promise<void> {
    this.resetSessionCalls++;
    this._sessionState = undefined;
  }
}

// ── Helper to access internal client ──

interface MemberInfo {
  name: string;
  type: AgentType;
  role?: string;
}

interface MockClient {
  agent: AgentCard;
  emit(event: string, ...args: unknown[]): boolean;
  chatCalls: Array<{ text: string; mentions?: string[] }>;
  executionLogCalls: Array<{ event: string; summary: string; options?: Record<string, unknown> }>;
  schedulesStore: Array<Record<string, unknown>>;
  createScheduleCalls: Array<Record<string, unknown>>;
  deleteScheduleCalls: string[];
  listSchedulesCalls: number;
}

function getClient(runner: AgentRunner): MockClient {
  return (runner as unknown as { client: MockClient }).client;
}

/** Register a member in the runner's memberInfo map via agent-join event. */
function registerMember(runner: AgentRunner, id: string, name: string, type: AgentType, role?: string): void {
  const client = getClient(runner);
  client.emit('agent-join', {
    id: `join-${id}`,
    type: 'agent.join',
    from: 'server',
    timestamp: Date.now(),
    payload: { agent: { id, name, type, role } },
  });
  // Drain the pending notice so it doesn't leak into tests
  (runner as unknown as { pendingNotices: string[] }).pendingNotices = [];
}

// ── Tests ──

describe('buildSkynetIntro', () => {
  it('includes agent name in identity statement', () => {
    const intro = buildSkynetIntro('bob');
    expect(intro).toContain('You are **bob**');
    expect(intro).toContain('@bob');
    expect(intro).toContain('Never @mention yourself');
  });

  it('includes messaging rules', () => {
    const intro = buildSkynetIntro('alice');
    expect(intro).toContain('Messaging Rules');
    expect(intro).toContain('<no-reply />');
  });
});

describe('AgentRunner system prompt identity', () => {
  it('injects agent name into adapter persona', async () => {
    const adapter = new FakeAdapter();
    new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentName: 'test-bot',
    });

    expect(adapter.persona).toContain('You are **test-bot**');
    expect(adapter.persona).toContain('@test-bot');
  });

  it('combines role, persona, and identity into adapter persona', async () => {
    const adapter = new FakeAdapter();
    new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentName: 'my-agent',
      role: 'backend engineer',
      persona: 'Expert in Node.js.',
    });

    expect(adapter.persona).toContain('You are a backend engineer.');
    expect(adapter.persona).toContain('Expert in Node.js.');
    expect(adapter.persona).toContain('You are **my-agent**');
  });
});

describe('AgentRunner pending notices', () => {
  let adapter: FakeAdapter;
  let runner: AgentRunner;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentName: 'test-agent',
      debounceMs: 0,
    });
    await runner.start();
  });

  it('piggybacks join notice onto next message', async () => {
    const client = getClient(runner);

    // Simulate a new agent joining
    client.emit('agent-join', {
      id: 'join-msg',
      type: 'agent.join',
      from: 'server',
      timestamp: Date.now(),
      payload: { agent: { id: 'new-1', name: 'newcomer', type: 'claude-code' } },
    });

    // Send a chat message — notice should be passed separately, not in payload text
    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    expect(adapter.handleMessageCalls).toHaveLength(1);
    const receivedText = (adapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(receivedText).toBe('hello');
    expect(adapter.handleMessageNotices[0]).toContain('[System] newcomer has joined the workspace.');
  });

  it('piggybacks leave notice onto next message', async () => {
    const client = getClient(runner);

    // First register the agent in member names
    client.emit('agent-join', {
      id: 'join-msg-2',
      type: 'agent.join',
      from: 'server',
      timestamp: Date.now(),
      payload: { agent: { id: 'leaving-1', name: 'leaver', type: 'claude-code' } },
    });

    // Clear the join notice by processing a message
    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 50));

    // Now simulate leave
    client.emit('agent-leave', {
      id: 'leave-msg',
      type: 'agent.leave',
      from: 'server',
      timestamp: Date.now(),
      payload: { agentId: 'leaving-1' },
    });

    // Send another message — notice should be passed separately, not in payload text
    const msg2 = makeChatMsg({ from: 'user-a', text: 'second', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 50));

    expect(adapter.handleMessageCalls).toHaveLength(2);
    const receivedText = (adapter.handleMessageCalls[1].payload as { text: string }).text;
    expect(receivedText).toBe('second');
    expect(adapter.handleMessageNotices[1]).toContain('[System] leaver has left the workspace.');
  });

  it('no notices means original message text is unchanged', async () => {
    const client = getClient(runner);

    const msg = makeChatMsg({ from: 'user-a', text: 'clean message', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    const receivedText = (adapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(receivedText).toBe('clean message');
    expect(adapter.handleMessageNotices[0]).toBeUndefined();
  });

  it('clears notices generated during start()', async () => {
    // Create a fresh runner and simulate join events during connection
    const freshAdapter = new FakeAdapter();
    const freshRunner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter: freshAdapter,
      agentName: 'fresh-agent',
      debounceMs: 0,
    });

    // start() clears notices, so any join events from initial state won't leak
    await freshRunner.start();

    const client = getClient(freshRunner);
    const msg = makeChatMsg({ from: 'user-a', text: 'after start', mentions: [freshRunner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    const receivedText = (freshAdapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(receivedText).toBe('after start');
  });
});

describe('AgentRunner agentId', () => {
  it('uses provided agentId instead of generating a new one', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentId: 'registered-id-123',
    });
    await runner.start();

    expect(runner.agentId).toBe('registered-id-123');
  });

  it('generates a random UUID when agentId is not provided', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
    });
    await runner.start();

    // Should be a valid UUID format
    expect(runner.agentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('AgentRunner fork dispatch', () => {
  let adapter: FakeAdapter;
  let runner: AgentRunner;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
  });

  it('idle + @mentioned chat message → normal handleMessage (no fork)', async () => {
    const client = getClient(runner);
    const msg = makeChatMsg({ mentions: [runner.agentId] });

    client.emit('chat', msg);

    // Allow async processing
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.handleMessageCalls).toHaveLength(1);
    expect(adapter.quickReplyCalls).toHaveLength(0);
  });

  it('idle + chat without mention → ignored', async () => {
    const client = getClient(runner);
    const msg = makeChatMsg();

    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.handleMessageCalls).toHaveLength(0);
  });

  it('idle + @all chat message → processed', async () => {
    const client = getClient(runner);
    const msg = makeChatMsg({ mentions: [MENTION_ALL] });

    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.handleMessageCalls).toHaveLength(1);
  });

  it('busy + @mentioned chat from human + supportsQuickReply=true → uses quickReply', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    // Register human senders
    registerMember(runner, 'user-a', 'UserA', AgentType.HUMAN);
    registerMember(runner, 'user-b', 'UserB', AgentType.HUMAN);

    const client = getClient(runner);

    // First message makes runner busy
    const msg1 = makeChatMsg({ from: 'user-a', text: 'do something complex', mentions: [runner.agentId] });
    client.emit('chat', msg1);

    // Allow processQueue to start (but not finish due to delay)
    await new Promise(r => setTimeout(r, 10));

    // Second message arrives while busy — @mentioned this agent, from human
    const msg2 = makeChatMsg({ from: 'user-b', text: 'how is progress?', mentions: [runner.agentId] });
    client.emit('chat', msg2);

    await new Promise(r => setTimeout(r, 10));

    // msg2 should be handled via quickReply, not queued
    expect(adapter.quickReplyCalls).toHaveLength(1);
    expect(adapter.quickReplyCalls[0]).toContain('how is progress?');

    // quickReply response should be sent via client.chat
    expect(client.chatCalls.some((c: { text: string }) => c.text === 'quick reply')).toBe(true);

    // Wait for first message to finish
    await new Promise(r => setTimeout(r, 150));
  });

  it('busy + @mentioned chat from agent + supportsQuickReply=true → queues (no fork)', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    // Register an agent sender (not human)
    registerMember(runner, 'agent-x', 'AgentX', AgentType.CLAUDE_CODE);

    const client = getClient(runner);

    // First message makes runner busy (from a human)
    registerMember(runner, 'user-a', 'UserA', AgentType.HUMAN);
    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Agent message arrives while busy — should queue, not fork
    const msg2 = makeChatMsg({ from: 'agent-x', text: 'agent chat', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.quickReplyCalls).toHaveLength(0);

    // Wait for queue to drain
    await new Promise(r => setTimeout(r, 200));

    // Both processed via handleMessage (no fork)
    expect(adapter.handleMessageCalls).toHaveLength(2);
  });

  it('busy + message without @mention → ignored entirely', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Message without mention — should be ignored entirely
    const msg2 = makeChatMsg({ from: 'user-b', text: 'general chat' });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.quickReplyCalls).toHaveLength(0);

    // Wait for queue to drain
    await new Promise(r => setTimeout(r, 200));

    // Only msg1 processed
    expect(adapter.handleMessageCalls).toHaveLength(1);
  });

  it('busy + @mentioned via mentions array from human → forks', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    registerMember(runner, 'user-a', 'UserA', AgentType.HUMAN);
    registerMember(runner, 'user-b', 'UserB', AgentType.HUMAN);

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Message mentions this agent (via mentions array), from human
    const msg2 = makeChatMsg({ from: 'user-b', text: 'hey agent', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.quickReplyCalls).toHaveLength(1);

    await new Promise(r => setTimeout(r, 150));
  });

  it('busy + max 1 concurrent fork → second @mention from human queues', async () => {
    adapter.handleDelay = 200;
    adapter.setSupportsQuickReply(true);

    registerMember(runner, 'user-a', 'UserA', AgentType.HUMAN);
    registerMember(runner, 'user-b', 'UserB', AgentType.HUMAN);
    registerMember(runner, 'user-c', 'UserC', AgentType.HUMAN);

    // Make quickReply slow so we can test concurrency
    adapter.quickReply = async (prompt: string) => {
      adapter.quickReplyCalls.push(prompt);
      await new Promise(r => setTimeout(r, 100));
      return 'quick reply';
    };

    const client = getClient(runner);

    // First message makes runner busy
    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Second message: @mentioned from human → should fork
    const msg2 = makeChatMsg({ from: 'user-b', text: 'first mention', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    // Third message: @mentioned from human → fork in progress, should queue
    const msg3 = makeChatMsg({ from: 'user-c', text: 'second mention', mentions: [runner.agentId] });
    client.emit('chat', msg3);
    await new Promise(r => setTimeout(r, 10));

    // Only one fork should have started
    expect(adapter.quickReplyCalls).toHaveLength(1);

    // Wait for everything to drain
    await new Promise(r => setTimeout(r, 400));

    // msg3 should have been processed via normal handleMessage
    expect(adapter.handleMessageCalls).toHaveLength(2); // msg1 + msg3
  });

  it('busy + chat + supportsQuickReply=false → queues normally', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(false);

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    const msg2 = makeChatMsg({ from: 'user-b', text: 'second', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    // No fork — should not have called quickReply
    expect(adapter.quickReplyCalls).toHaveLength(0);

    // Wait for queue to drain
    await new Promise(r => setTimeout(r, 200));

    // Both messages processed via handleMessage
    expect(adapter.handleMessageCalls).toHaveLength(2);
  });

  it('busy + task-assign → always queues (never forks)', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    const taskMsg = makeTaskMsg();
    client.emit('task-assign', taskMsg);
    await new Promise(r => setTimeout(r, 10));

    // Task should not trigger quickReply
    expect(adapter.quickReplyCalls).toHaveLength(0);

    // Wait for queue to drain
    await new Promise(r => setTimeout(r, 200));
  });

  it('quickReply failure → message falls back to queue', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    registerMember(runner, 'user-a', 'UserA', AgentType.HUMAN);
    registerMember(runner, 'user-b', 'UserB', AgentType.HUMAN);

    // Make quickReply throw
    let quickReplyCallCount = 0;
    adapter.quickReply = async (_prompt: string) => {
      quickReplyCallCount++;
      throw new Error('fork failed');
    };

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // @mentioned from human — will attempt fork
    const msg2 = makeChatMsg({ from: 'user-b', text: 'status?', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    expect(quickReplyCallCount).toBe(1);

    // Wait for queue to drain — msg2 should have been re-queued
    await new Promise(r => setTimeout(r, 200));

    // msg2 should eventually be processed via handleMessage after fallback
    expect(adapter.handleMessageCalls).toHaveLength(2);
  });

  it('skips messages from self', async () => {
    const client = getClient(runner);
    const selfMsg = makeChatMsg({ from: runner.agentId });

    client.emit('chat', selfMsg);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.handleMessageCalls).toHaveLength(0);
    expect(adapter.quickReplyCalls).toHaveLength(0);
  });

  it('deduplicates messages with the same ID', async () => {
    const client = getClient(runner);
    const msg = makeChatMsg({ from: 'user-a', text: 'duplicate test', mentions: [runner.agentId] });

    // Send the same message twice
    client.emit('chat', msg);
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    // Should only be processed once
    expect(adapter.handleMessageCalls).toHaveLength(1);
  });

  it('refreshes member names on workspace-state event', async () => {
    const client = getClient(runner);

    // Simulate reconnection workspace state
    client.emit('workspace-state', {
      members: [
        { id: 'new-agent', name: 'NewAgent', type: 'claude-code' },
      ],
      recentMessages: [],
    });

    // Send a message from the new agent mentioning this agent
    const msg = makeChatMsg({ from: 'new-agent', text: 'hi', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    // Should resolve the sender name from updated member list
    expect(adapter.handleMessageCalls).toHaveLength(1);
  });
});

describe('AgentRunner batch processing', () => {
  let adapter: FakeAdapter;
  let runner: AgentRunner;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    adapter.handleDelay = 100;
    runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
  });

  it('batches multiple queued chat messages into one adapter call', async () => {
    const client = getClient(runner);

    // First message starts processing (takes 100ms)
    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Queue up two more messages while busy
    const msg2 = makeChatMsg({ from: 'user-a', text: 'second', mentions: [runner.agentId] });
    const msg3 = makeChatMsg({ from: 'user-a', text: 'third', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    client.emit('chat', msg3);

    // Wait for everything to drain
    await new Promise(r => setTimeout(r, 300));

    // msg1 processed individually, msg2+msg3 batched into one call
    expect(adapter.handleMessageCalls).toHaveLength(2);

    // The batched message should contain both texts
    const batchedMsg = adapter.handleMessageCalls[1];
    const batchText = (batchedMsg.payload as { text: string }).text;
    expect(batchText).toContain('second');
    expect(batchText).toContain('third');
    expect(batchText).toContain('2 unread messages');
  });

  it('batches messages from multiple senders and mentions all senders', async () => {
    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Queue messages from different senders
    const msg2 = makeChatMsg({ from: 'user-a', text: 'from A', mentions: [runner.agentId] });
    const msg3 = makeChatMsg({ from: 'user-b', text: 'from B', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    client.emit('chat', msg3);

    await new Promise(r => setTimeout(r, 300));

    // Batched response should mention both senders
    const batchResponse = client.chatCalls.find(c =>
      c.mentions && c.mentions.includes('user-a') && c.mentions.includes('user-b')
    );
    expect(batchResponse).toBeDefined();
  });

  it('single queued message is processed normally (not batched)', async () => {
    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Only one message queued
    const msg2 = makeChatMsg({ from: 'user-b', text: 'second', mentions: [runner.agentId] });
    client.emit('chat', msg2);

    await new Promise(r => setTimeout(r, 300));

    // Both processed individually (no batching for single queued message)
    expect(adapter.handleMessageCalls).toHaveLength(2);
    const secondMsg = adapter.handleMessageCalls[1];
    const text = (secondMsg.payload as { text: string }).text;
    expect(text).toBe('second'); // Original text, not batched format
  });

  it('tasks are processed individually even when mixed with chat', async () => {
    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Queue: chat, task, chat
    const msg2 = makeChatMsg({ from: 'user-a', text: 'second', mentions: [runner.agentId] });
    const taskMsg = makeTaskMsg();
    const msg3 = makeChatMsg({ from: 'user-a', text: 'third', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    client.emit('task-assign', taskMsg);
    client.emit('chat', msg3);

    await new Promise(r => setTimeout(r, 600));

    // msg1 processed, msg2 processed (single chat before task), task processed, msg3 processed
    expect(adapter.handleMessageCalls).toHaveLength(3); // msg1, msg2, msg3
  });
});

describe('AgentRunner state persistence', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skynet-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('persists lastSeenTimestamp after processing messages', async () => {
    const statePath = join(testDir, 'state.json');
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      statePath,
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);

    // Simulate receiving a message with a known timestamp
    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    // Override timestamp to a predictable value
    (msg as { timestamp: number }).timestamp = 42000;
    // Also set lastSeenTimestamp on the mock client
    (client as unknown as { lastSeenTimestamp: number }).lastSeenTimestamp = 42000;

    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    // State file should exist with the timestamp
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.lastSeenTimestamp).toBe(42000);
  });

  it('loads lastSeenTimestamp from state file on start', async () => {
    const statePath = join(testDir, 'state.json');

    // Write existing state
    const { writeFileSync } = await import('node:fs');
    writeFileSync(statePath, JSON.stringify({ lastSeenTimestamp: 99000 }));

    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      statePath,
      debounceMs: 0,
    });
    await runner.start();

    // The client should have been constructed with the persisted timestamp
    const client = getClient(runner);
    expect((client as unknown as { lastSeenTimestamp: number }).lastSeenTimestamp).toBe(99000);
  });

  it('persists session state alongside lastSeenTimestamp', async () => {
    const statePath = join(testDir, 'state.json');
    const adapter = new FakeAdapter();
    adapter.setSessionState({ sessionId: 'test-sid-1', sessionStarted: true });

    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      statePath,
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.session).toEqual({ sessionId: 'test-sid-1', sessionStarted: true });
  });

  it('restores session state from state file on start', async () => {
    const statePath = join(testDir, 'state.json');

    const { writeFileSync } = await import('node:fs');
    writeFileSync(statePath, JSON.stringify({
      lastSeenTimestamp: 50000,
      session: { sessionId: 'persisted-sid', sessionStarted: true },
    }));

    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      statePath,
      debounceMs: 0,
    });
    await runner.start();

    // Adapter should have received the restored session state
    expect(adapter.restoredSessionState).toEqual({
      sessionId: 'persisted-sid',
      sessionStarted: true,
    });
  });

  it('handles state file without session field gracefully', async () => {
    const statePath = join(testDir, 'state.json');

    const { writeFileSync } = await import('node:fs');
    writeFileSync(statePath, JSON.stringify({ lastSeenTimestamp: 10000 }));

    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      statePath,
      debounceMs: 0,
    });
    await runner.start();

    // No session to restore — adapter should not have been called
    expect(adapter.restoredSessionState).toBeUndefined();
  });
});

describe('AgentRunner debounce', () => {
  it('delays processing of idle chat messages by debounce window', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 200,
    });
    await runner.start();
    const client = getClient(runner);

    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);

    // Should NOT have processed yet (within debounce window)
    await new Promise(r => setTimeout(r, 50));
    expect(adapter.handleMessageCalls).toHaveLength(0);

    // After debounce window, should be processed
    await new Promise(r => setTimeout(r, 200));
    expect(adapter.handleMessageCalls).toHaveLength(1);
  });

  it('batches multiple chat messages arriving within debounce window', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 200,
    });
    await runner.start();
    const client = getClient(runner);

    // Send 3 messages within the debounce window
    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    const msg2 = makeChatMsg({ from: 'user-b', text: 'second', mentions: [runner.agentId] });
    const msg3 = makeChatMsg({ from: 'user-a', text: 'third', mentions: [runner.agentId] });
    client.emit('chat', msg1);

    await new Promise(r => setTimeout(r, 50));
    client.emit('chat', msg2);

    await new Promise(r => setTimeout(r, 50));
    client.emit('chat', msg3);

    // Still within debounce window of last message — nothing processed yet
    await new Promise(r => setTimeout(r, 50));
    expect(adapter.handleMessageCalls).toHaveLength(0);

    // After debounce fires, all 3 should be batched into one call
    await new Promise(r => setTimeout(r, 250));
    expect(adapter.handleMessageCalls).toHaveLength(1);
    const batchText = (adapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(batchText).toContain('3 unread messages');
    expect(batchText).toContain('first');
    expect(batchText).toContain('second');
    expect(batchText).toContain('third');
  });

  it('task messages bypass debounce and flush pending chat messages', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 500,
    });
    await runner.start();
    const client = getClient(runner);

    // Queue a chat message (debounce starts)
    const msg = makeChatMsg({ from: 'user-a', text: 'chat before task', mentions: [runner.agentId] });
    client.emit('chat', msg);

    // Immediately send a task — should bypass debounce
    const taskMsg = makeTaskMsg();
    client.emit('task-assign', taskMsg);

    await new Promise(r => setTimeout(r, 50));

    // Chat message should have been processed (flushed by task), plus task handled
    expect(adapter.handleMessageCalls).toHaveLength(1);
    const chatText = (adapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(chatText).toContain('chat before task');
  });

  it('messages queued during processing are debounced after processing finishes', async () => {
    const adapter = new FakeAdapter();
    adapter.handleDelay = 100;
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 200,
    });
    await runner.start();
    const client = getClient(runner);

    // First message processed after debounce
    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 250));
    expect(adapter.handleMessageCalls).toHaveLength(1);

    // Second message arrives during processing — queued
    const msg2 = makeChatMsg({ from: 'user-b', text: 'second', mentions: [runner.agentId] });
    client.emit('chat', msg2);

    // After msg1 finishes, msg2 should NOT be processed immediately — it must age
    await new Promise(r => setTimeout(r, 120));
    expect(adapter.handleMessageCalls).toHaveLength(1);

    // After debounce window from msg2's arrival, it should be processed
    await new Promise(r => setTimeout(r, 200));
    expect(adapter.handleMessageCalls).toHaveLength(2);
  });

  it('stop() clears debounce timer and prevents processing', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 200,
    });
    await runner.start();
    const client = getClient(runner);

    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);

    // Stop before debounce fires
    await runner.stop();

    // Wait past the debounce window
    await new Promise(r => setTimeout(r, 300));

    // Should not have been processed
    expect(adapter.handleMessageCalls).toHaveLength(0);
  });

  it('debounceMs: 0 disables debounce (immediate processing)', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
    const client = getClient(runner);

    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);

    await new Promise(r => setTimeout(r, 10));
    expect(adapter.handleMessageCalls).toHaveLength(1);
  });

  it('messages arriving during processing are batched after debounce', async () => {
    const adapter = new FakeAdapter();
    adapter.handleDelay = 100;
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 200,
    });
    await runner.start();
    const client = getClient(runner);

    // First message processed after debounce
    const msg1 = makeChatMsg({ from: 'user-a', text: 'start debate', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 250));
    expect(adapter.handleMessageCalls).toHaveLength(1);

    // Follow-up arrives during processing
    const msg2 = makeChatMsg({ from: 'user-b', text: 'follow-up 1', mentions: [runner.agentId] });
    client.emit('chat', msg2);

    // msg1 finishes, msg2 needs to age — not processed yet
    await new Promise(r => setTimeout(r, 120));
    expect(adapter.handleMessageCalls).toHaveLength(1);

    // A third message arrives — resets the debounce wait for the newest
    const msg3 = makeChatMsg({ from: 'user-a', text: 'follow-up 2', mentions: [runner.agentId] });
    client.emit('chat', msg3);

    // Wait for msg3 to age + processing
    await new Promise(r => setTimeout(r, 350));
    expect(adapter.handleMessageCalls).toHaveLength(2);
    const batchText = (adapter.handleMessageCalls[1].payload as { text: string }).text;
    expect(batchText).toContain('2 unread messages');
  });

  it('defaults to DEFAULT_DEBOUNCE_MS when debounceMs is not set', () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
    });
    // Access private field to verify default
    const ms = (runner as unknown as { debounceMs: number }).debounceMs;
    expect(ms).toBe(3000);
  });
});

describe('AgentRunner interrupt', () => {
  let adapter: FakeAdapter;
  let runner: AgentRunner;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    adapter.handleDelay = 200;
    runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
  });

  it('clears message queue on interrupt', async () => {
    const client = getClient(runner);

    // Start processing a message (takes 200ms)
    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Queue another message
    const msg2 = makeChatMsg({ from: 'user-a', text: 'more work', mentions: [runner.agentId] });
    client.emit('chat', msg2);

    // Interrupt
    client.emit('agent-interrupt', {
      id: 'ctrl-1',
      type: 'agent.interrupt',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    // Queue should be empty and agent should be idle
    const queue = (runner as unknown as { messageQueue: unknown[] }).messageQueue;
    expect(queue).toHaveLength(0);

    // Wait for any remaining processing to settle
    await new Promise(r => setTimeout(r, 250));
  });

  it('sets status to idle after interrupt', async () => {
    const client = getClient(runner);

    // Start processing
    const msg = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 10));

    // Interrupt
    client.emit('agent-interrupt', {
      id: 'ctrl-2',
      type: 'agent.interrupt',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    const processing = (runner as unknown as { processing: boolean }).processing;
    expect(processing).toBe(false);
  });

  it('can accept new messages after interrupt', async () => {
    const client = getClient(runner);

    // Start processing (takes 200ms)
    const msg1 = makeChatMsg({ from: 'user-a', text: 'first', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Interrupt
    client.emit('agent-interrupt', {
      id: 'ctrl-3',
      type: 'agent.interrupt',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    // Reset delay so new message completes quickly
    adapter.handleDelay = 0;

    // Send a new message — should be processed normally
    const msg2 = makeChatMsg({ from: 'user-a', text: 'after interrupt', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 50));

    // The adapter should have received the new message
    const hasAfterInterrupt = adapter.handleMessageCalls.some(
      m => (m.payload as { text: string }).text === 'after interrupt'
    );
    expect(hasAfterInterrupt).toBe(true);
  });
});

describe('AgentRunner forget', () => {
  let adapter: FakeAdapter;
  let runner: AgentRunner;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
  });

  it('clears message queue and processed IDs on forget', async () => {
    const client = getClient(runner);

    // Process a message so processedMessageIds is populated
    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    const processedIds = (runner as unknown as { processedMessageIds: Set<string> }).processedMessageIds;
    expect(processedIds.size).toBeGreaterThan(0);

    // Forget
    client.emit('agent-forget', {
      id: 'ctrl-4',
      type: 'agent.forget',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    expect(processedIds.size).toBe(0);
    const queue = (runner as unknown as { messageQueue: unknown[] }).messageQueue;
    expect(queue).toHaveLength(0);
  });

  it('resets processing state on forget', async () => {
    const client = getClient(runner);

    // Forget
    client.emit('agent-forget', {
      id: 'ctrl-5',
      type: 'agent.forget',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    const processing = (runner as unknown as { processing: boolean }).processing;
    expect(processing).toBe(false);
  });

  it('agent can process new messages after forget', async () => {
    const client = getClient(runner);

    // Process a message
    const msg1 = makeChatMsg({ from: 'user-a', text: 'before forget', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 50));

    // Forget
    client.emit('agent-forget', {
      id: 'ctrl-6',
      type: 'agent.forget',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    // Send new message
    const msg2 = makeChatMsg({ from: 'user-a', text: 'after forget', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 50));

    const hasAfterForget = adapter.handleMessageCalls.some(
      m => (m.payload as { text: string }).text === 'after forget'
    );
    expect(hasAfterForget).toBe(true);
  });

  it('processQueue bails out and does not persistState after forget during processing', async () => {
    // Use a slow adapter to simulate a long-running handleMessage
    const adapter = new FakeAdapter();
    adapter.handleDelay = 200;
    const statePath = join(tmpdir(), `skynet-test-${Math.random().toString(36).slice(2)}`, 'state.json');
    mkdirSync(dirname(statePath), { recursive: true });

    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentName: 'test-agent',
      debounceMs: 0,
      statePath,
    });
    await runner.start();

    const client = getClient(runner);

    // Send a message that will take 200ms to process
    const msg1 = makeChatMsg({ from: 'user-a', text: 'slow msg', mentions: [runner.agentId] });
    client.emit('chat', msg1);

    // Wait for processing to start but not finish
    await new Promise(r => setTimeout(r, 50));
    const processingBefore = (runner as unknown as { processing: boolean }).processing;
    expect(processingBefore).toBe(true);

    // Send forget while processing
    client.emit('agent-forget', {
      id: 'ctrl-forget-race',
      type: 'agent.forget',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 20));

    // After forget, processing should be false (handleForget resets it)
    const processingAfterForget = (runner as unknown as { processing: boolean }).processing;
    expect(processingAfterForget).toBe(false);

    // resetSession should have been called
    expect(adapter.resetSessionCalls).toBe(1);

    // Wait for the slow handleMessage to finish
    await new Promise(r => setTimeout(r, 250));

    // Processing should still be false (processQueue should have bailed out)
    const processingFinal = (runner as unknown as { processing: boolean }).processing;
    expect(processingFinal).toBe(false);

    // Clean up
    rmSync(dirname(statePath), { recursive: true, force: true });
  });

  it('forget persists the reset state', async () => {
    const adapter = new FakeAdapter();
    adapter.setSessionState({ sessionId: 'old-session', sessionStarted: true });
    const statePath = join(tmpdir(), `skynet-test-${Math.random().toString(36).slice(2)}`, 'state.json');
    mkdirSync(dirname(statePath), { recursive: true });

    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentName: 'test-agent',
      debounceMs: 0,
      statePath,
    });
    await runner.start();

    const client = getClient(runner);

    // Forget
    client.emit('agent-forget', {
      id: 'ctrl-persist',
      type: 'agent.forget',
      from: runner.agentId,
      timestamp: Date.now(),
      payload: { agentId: runner.agentId },
    });
    await new Promise(r => setTimeout(r, 50));

    // State file should exist (handleForget now calls persistState)
    expect(existsSync(statePath)).toBe(true);

    // Clean up
    rmSync(dirname(statePath), { recursive: true, force: true });
  });
});

describe('AgentRunner agent-join race condition', () => {
  it('captures agent-join events emitted during connect()', async () => {
    const adapter = new FakeAdapter();
    adapter.handleResponse = 'Hello @late-joiner welcome!';
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentName: 'test-agent',
      debounceMs: 0,
    });

    const client = getClient(runner);

    // Simulate an agent joining DURING connect() — before the promise resolves.
    // This reproduces the race condition where agents that join between
    // workspace.state and handler registration are missed.
    (client as unknown as { onConnecting: (() => void) | null }).onConnecting = () => {
      client.emit('agent-join', {
        id: 'join-late',
        type: 'agent.join',
        from: 'server',
        timestamp: Date.now(),
        payload: { agent: { id: 'late-agent-id', name: 'late-joiner', type: AgentType.CLAUDE_CODE } },
      });
    };

    await runner.start();

    // Verify the late-joining agent is in memberInfo
    const memberInfo = (runner as unknown as { memberInfo: Map<string, MemberInfo> }).memberInfo;
    expect(memberInfo.has('late-agent-id')).toBe(true);
    expect(memberInfo.get('late-agent-id')!.name).toBe('late-joiner');

    // Verify agent can respond to messages (mention resolution is server-side)
    const msg = makeChatMsg({ from: 'human-1', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    expect(client.chatCalls.length).toBeGreaterThan(0);
    const lastCall = client.chatCalls[client.chatCalls.length - 1];
    // Client includes original sender; server enriches @name mentions
    expect(lastCall.mentions).toContain('human-1');
  });
});

describe('AgentRunner prompt logging', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skynet-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('logs prompt text to agent log via onPrompt callback', async () => {
    const adapter = new FakeAdapter();
    const logFile = join(testDir, 'agent.log');
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      logFile,
      debounceMs: 0,
    });
    await runner.start();

    // Verify the onPrompt callback was wired up
    expect(adapter.onPrompt).toBeDefined();

    // Simulate the adapter calling onPrompt (as real adapters do)
    adapter.onPrompt!('hello world', { type: 'message' });
    await new Promise(r => setTimeout(r, 100));

    await runner.stop();

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, 'utf-8');
    expect(content).toContain('[prompt] type=message');
    expect(content).toContain('hello world');
  });

  it('does not create prompt.log even when statePath is set', async () => {
    const statePath = join(testDir, 'state.json');
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      statePath,
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    const msg = makeChatMsg({ from: 'user-a', text: 'test', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    await runner.stop();

    const promptLogPath = join(testDir, 'prompt.log');
    expect(existsSync(promptLogPath)).toBe(false);
  });
});

describe('isNoReply', () => {
  // XML tag: <no-reply />
  it('detects exact <no-reply /> tag', () => {
    expect(isNoReply('<no-reply />')).toBe(true);
  });

  it('detects <no-reply /> with surrounding whitespace', () => {
    expect(isNoReply('  <no-reply />  ')).toBe(true);
    expect(isNoReply('\n<no-reply />\n')).toBe(true);
  });

  it('detects <no-reply /> embedded in other text (suppresses entire message)', () => {
    expect(isNoReply('I have nothing to add.\n\n<no-reply />')).toBe(true);
  });

  it('detects <no-reply/> without space before slash', () => {
    expect(isNoReply('<no-reply/>')).toBe(true);
  });

  // Negative cases
  it('does not match plain text NO_REPLY', () => {
    expect(isNoReply('NO_REPLY')).toBe(false);
  });

  it('does not match normal messages', () => {
    expect(isNoReply('Hello world')).toBe(false);
    expect(isNoReply('@pm Here is my update.')).toBe(false);
  });
});

describe('AgentRunner stop() listener cleanup', () => {
  it('removes all client listeners on stop()', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
    const client = getClient(runner);

    // Client should have listeners registered by start()
    const listenerCountBefore = (client as unknown as { listenerCount(e: string): number }).listenerCount('chat');
    expect(listenerCountBefore).toBeGreaterThan(0);

    await runner.stop();

    // After stop(), all listeners should be removed
    const listenerCountAfter = (client as unknown as { listenerCount(e: string): number }).listenerCount('chat');
    expect(listenerCountAfter).toBe(0);
  });

  it('does not process messages after stop()', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      debounceMs: 0,
    });
    await runner.start();
    const client = getClient(runner);

    await runner.stop();

    // Emit a message after stop — should not be processed since listeners are removed
    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);

    await new Promise(r => setTimeout(r, 50));
    expect(adapter.handleMessageCalls).toHaveLength(0);
  });
});

describe('AgentRunner execution log emissions', () => {
  /** Simulate a /watch control message from a human. */
  function emitWatch(client: { emit: (event: string, msg: unknown) => boolean }, agentId: string, humanId: string): void {
    client.emit('agent-watch', {
      id: `watch-${Math.random().toString(36).slice(2)}`,
      type: 'agent.watch',
      from: agentId,
      timestamp: Date.now(),
      payload: { agentId, humanId },
      mentions: [agentId],
    });
  }

  function emitUnwatch(client: { emit: (event: string, msg: unknown) => boolean }, agentId: string, humanId: string): void {
    client.emit('agent-unwatch', {
      id: `unwatch-${Math.random().toString(36).slice(2)}`,
      type: 'agent.unwatch',
      from: agentId,
      timestamp: Date.now(),
      payload: { agentId, humanId },
      mentions: [agentId],
    });
  }

  it('does NOT emit execution logs when no one is watching', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'test-agent-silent',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    registerMember(runner, 'human-1', 'alice', AgentType.HUMAN);

    const msg = makeChatMsg({ mentions: ['test-agent-silent'] });
    client.emit('chat', msg);

    await new Promise(r => setTimeout(r, 100));

    // No one watching → no execution logs
    expect(client.executionLogCalls).toHaveLength(0);

    await runner.stop();
  });

  it('emits processing.start and processing.end when watched', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'test-agent-logs',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    registerMember(runner, 'human-1', 'alice', AgentType.HUMAN);

    // Enable watching
    emitWatch(client, 'test-agent-logs', 'human-1');

    const msg = makeChatMsg({ mentions: ['test-agent-logs'] });
    client.emit('chat', msg);

    await new Promise(r => setTimeout(r, 100));

    const logEvents = client.executionLogCalls.map(c => c.event);
    expect(logEvents).toContain('processing.start');
    expect(logEvents).toContain('processing.end');

    // processing.end should include durationMs
    const endLog = client.executionLogCalls.find(c => c.event === 'processing.end');
    expect(endLog?.options?.durationMs).toBeDefined();

    // Logs should mention the watching human
    expect(endLog?.options?.mentions).toEqual(['human-1']);

    await runner.stop();
  });

  it('emits processing.error on failure when watched', async () => {
    const adapter = new FakeAdapter();
    adapter.handleResponse = ''; // empty
    const originalHandleMessage = adapter.handleMessage.bind(adapter);
    adapter.handleMessage = async () => {
      throw new Error('test failure');
    };
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'test-agent-err',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    registerMember(runner, 'human-1', 'alice', AgentType.HUMAN);
    emitWatch(client, 'test-agent-err', 'human-1');

    const msg = makeChatMsg({ mentions: ['test-agent-err'] });
    client.emit('chat', msg);

    await new Promise(r => setTimeout(r, 100));

    const errorLogs = client.executionLogCalls.filter(c => c.event === 'processing.error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].summary).toContain('test failure');

    // processing.end should NOT be emitted when there was an error
    const endLogs = client.executionLogCalls.filter(c => c.event === 'processing.end');
    expect(endLogs).toHaveLength(0);

    adapter.handleMessage = originalHandleMessage;
    await runner.stop();
  });

  it('sanitizes command-line errors in processing.error logs', async () => {
    const adapter = new FakeAdapter();
    adapter.handleMessage = async () => {
      const err = new Error(
        'Command failed with exit code 1: claude -p \'prompt\' --output-format stream-json --append-system-prompt \'You are a secret agent\''
      );
      (err as Record<string, unknown>).shortMessage = 'Command failed with exit code 1: claude -p \'prompt\' --output-format stream-json';
      throw err;
    };
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'test-agent-sanitize',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    registerMember(runner, 'human-1', 'alice', AgentType.HUMAN);
    emitWatch(client, 'test-agent-sanitize', 'human-1');

    const msg = makeChatMsg({ mentions: ['test-agent-sanitize'] });
    client.emit('chat', msg);

    await new Promise(r => setTimeout(r, 100));

    const errorLogs = client.executionLogCalls.filter(c => c.event === 'processing.error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].summary).not.toContain('--append-system-prompt');
    expect(errorLogs[0].summary).not.toContain('stream-json');
    expect(errorLogs[0].summary).toContain('exit code 1');

    await runner.stop();
  });

  it('adapter.onExecutionLog only sends when watched', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'test-agent-wire',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);

    // No watchers — callback should be a no-op
    adapter.onExecutionLog?.('tool.call', 'Read file.ts', { input: { file_path: '/foo.ts' } });
    expect(client.executionLogCalls).toHaveLength(0);

    // Enable watching
    emitWatch(client, 'test-agent-wire', 'human-1');

    adapter.onExecutionLog?.('tool.call', 'Edit file.ts', { input: {} });
    expect(client.executionLogCalls).toHaveLength(1);
    expect(client.executionLogCalls[0].event).toBe('tool.call');
    expect(client.executionLogCalls[0].summary).toBe('Edit file.ts');
    expect(client.executionLogCalls[0].options?.mentions).toEqual(['human-1']);

    await runner.stop();
  });

  it('unwatch stops execution log delivery', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'test-agent-unwatch',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);

    // Watch then unwatch
    emitWatch(client, 'test-agent-unwatch', 'human-1');
    emitUnwatch(client, 'test-agent-unwatch', 'human-1');

    adapter.onExecutionLog?.('tool.call', 'Read file.ts');
    expect(client.executionLogCalls).toHaveLength(0);

    await runner.stop();
  });
});

// ── Member roster and role awareness tests ──

describe('buildMemberRoster', () => {
  it('returns empty string when no other members', () => {
    const result = buildMemberRoster('self', [{ name: 'self', type: AgentType.CLAUDE_CODE }]);
    expect(result).toBe('');
  });

  it('returns empty string when members list is empty', () => {
    const result = buildMemberRoster('self', []);
    expect(result).toBe('');
  });

  it('lists other members with their roles', () => {
    const members = [
      { name: 'self', type: AgentType.CLAUDE_CODE, role: 'PM' },
      { name: 'bob', type: AgentType.CLAUDE_CODE, role: 'backend engineer' },
      { name: 'carol', type: AgentType.HUMAN },
    ];
    const result = buildMemberRoster('self', members);
    expect(result).toContain('@bob');
    expect(result).toContain('backend engineer');
    expect(result).toContain('@carol');
    expect(result).toContain('human');
    expect(result).not.toContain('@self');
  });

  it('omits role tag when role is undefined', () => {
    const members = [
      { name: 'alice', type: AgentType.GEMINI_CLI },
    ];
    const result = buildMemberRoster('self', members);
    expect(result).toContain('@alice');
    expect(result).not.toContain('—');
  });
});

describe('Agent role awareness', () => {
  it('join notice includes role when present', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    client.emit('agent-join', {
      id: 'join-1',
      type: 'agent.join',
      from: 'server',
      timestamp: Date.now(),
      payload: { agent: { id: 'bob-1', name: 'bob', type: AgentType.CLAUDE_CODE, role: 'backend engineer' } },
    });

    const notices = (runner as unknown as { pendingNotices: string[] }).pendingNotices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('bob');
    expect(notices[0]).toContain('backend engineer');

    await runner.stop();
  });

  it('join notice omits role when absent', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      debounceMs: 0,
    });
    await runner.start();

    const client = getClient(runner);
    client.emit('agent-join', {
      id: 'join-2',
      type: 'agent.join',
      from: 'server',
      timestamp: Date.now(),
      payload: { agent: { id: 'alice-1', name: 'alice', type: AgentType.HUMAN } },
    });

    const notices = (runner as unknown as { pendingNotices: string[] }).pendingNotices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toBe('[System] alice has joined the workspace.');

    await runner.stop();
  });

  it('leave notice includes role when present', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      debounceMs: 0,
    });
    await runner.start();

    // First register the member with a role
    const client = getClient(runner);
    client.emit('agent-join', {
      id: 'join-3',
      type: 'agent.join',
      from: 'server',
      timestamp: Date.now(),
      payload: { agent: { id: 'bob-1', name: 'bob', type: AgentType.CLAUDE_CODE, role: 'frontend dev' } },
    });
    // Clear join notice
    (runner as unknown as { pendingNotices: string[] }).pendingNotices = [];

    // Now emit leave
    client.emit('agent-leave', {
      id: 'leave-1',
      type: 'agent.leave',
      from: 'server',
      timestamp: Date.now(),
      payload: { agentId: 'bob-1' },
    });

    const notices = (runner as unknown as { pendingNotices: string[] }).pendingNotices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('bob');
    expect(notices[0]).toContain('frontend dev');

    await runner.stop();
  });

  it('memberInfo stores role from agent-join', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      debounceMs: 0,
    });
    await runner.start();

    registerMember(runner, 'bob-1', 'bob', AgentType.CLAUDE_CODE, 'PM');

    const memberInfo = (runner as unknown as { memberInfo: Map<string, MemberInfo> }).memberInfo;
    const bob = memberInfo.get('bob-1');
    expect(bob).toBeDefined();
    expect(bob!.role).toBe('PM');

    await runner.stop();
  });

  it('workspace-state updates memberInfo but does NOT refresh persona (preserves KV cache)', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      agentName: 'me',
      debounceMs: 0,
    });
    await runner.start();

    const personaBefore = adapter.persona;

    // Simulate a workspace-state event with members.
    const client = getClient(runner);
    client.emit('workspace-state', {
      members: [
        { id: 'me', name: 'me', type: AgentType.CLAUDE_CODE, status: 'idle' },
        { id: 'bob-1', name: 'bob', type: AgentType.CLAUDE_CODE, role: 'backend engineer', status: 'idle' },
        { id: 'carol-1', name: 'carol', type: AgentType.HUMAN, status: 'idle' },
      ],
      recentMessages: [],
    });

    // memberInfo should be updated
    const memberInfo = (runner as unknown as { memberInfo: Map<string, MemberInfo> }).memberInfo;
    expect(memberInfo.get('bob-1')).toEqual({ name: 'bob', type: AgentType.CLAUDE_CODE, role: 'backend engineer' });
    expect(memberInfo.get('carol-1')).toEqual({ name: 'carol', type: AgentType.HUMAN, role: undefined });

    // Persona should NOT have changed — avoids invalidating KV cache
    expect(adapter.persona).toBe(personaBefore);

    await runner.stop();
  });

  it('persona is refreshed after forget', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      agentName: 'me',
      debounceMs: 0,
    });
    await runner.start();

    // Register a member with a unique name (updates memberInfo but not persona)
    registerMember(runner, 'zara-1', 'zara', AgentType.CLAUDE_CODE, 'PM');

    // Persona should NOT contain zara yet (no refreshPersona on join)
    expect(adapter.persona).not.toContain('@zara');

    // Emit forget — this rebuilds the session and refreshes persona
    const client = getClient(runner);
    client.emit('agent-forget');

    // Wait for async resetSession
    await new Promise(r => setTimeout(r, 50));

    // Persona should now contain the member roster after forget
    expect(adapter.persona).toContain('@zara');
    expect(adapter.persona).toContain('PM');
    // Session should have been reset
    expect(adapter.resetSessionCalls).toBe(1);

    await runner.stop();
  });

  it('workspace-state reconnection does NOT refresh persona (preserves KV cache)', async () => {
    const adapter = new FakeAdapter();
    const runner = new AgentRunner({
      serverUrl: 'http://localhost:9999',
      adapter,
      agentId: 'me',
      agentName: 'me',
      debounceMs: 0,
    });
    await runner.start();

    const personaBefore = adapter.persona;

    // Simulate reconnection with workspace state that includes members
    const client = getClient(runner);
    client.emit('workspace-state', {
      members: [
        { id: 'me', name: 'me', type: AgentType.CLAUDE_CODE, status: 'idle' },
        { id: 'xavier-1', name: 'xavier', type: AgentType.CLAUDE_CODE, role: 'backend engineer', status: 'idle' },
      ],
      recentMessages: [],
    });

    // memberInfo should be updated for @mention resolution
    const memberInfo = (runner as unknown as { memberInfo: Map<string, MemberInfo> }).memberInfo;
    expect(memberInfo.get('xavier-1')).toEqual({ name: 'xavier', type: AgentType.CLAUDE_CODE, role: 'backend engineer' });

    // But persona should NOT change — avoids invalidating KV cache mid-session
    expect(adapter.persona).toBe(personaBefore);

    await runner.stop();
  });
});

describe('AgentRunner schedule command feedback', () => {
  let adapter: FakeAdapter;
  let runner: AgentRunner;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    runner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter,
      agentId: 'me',
      agentName: 'me',
      debounceMs: 0,
    });
    await runner.start();
    registerMember(runner, 'backend-1', 'backend', AgentType.CLAUDE_CODE, 'backend engineer');
  });

  afterEach(async () => {
    await runner.stop();
  });

  it('schedule-list feeds results back via quickReply', async () => {
    const client = getClient(runner);
    client.schedulesStore.push({
      id: 'sched-abc',
      name: 'daily-review',
      cronExpr: '0 9 * * *',
      agentId: 'backend-1',
      taskTemplate: { title: 'Review PRs', description: 'Check open PRs' },
      enabled: true,
      createdBy: 'human-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    adapter.handleResponse = 'Let me check. <schedule-list />';
    adapter.quickReplyResponse = 'Here are the schedules: daily-review runs at 9am.';

    const msg = makeChatMsg({ mentions: [runner.agentId], text: 'What schedules do we have?' });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 100));

    // quickReply should have been called with the schedule list
    expect(adapter.quickReplyCalls.length).toBe(1);
    expect(adapter.quickReplyCalls[0]).toContain('[System] Schedules (1)');
    expect(adapter.quickReplyCalls[0]).toContain('sched-abc');
    expect(adapter.quickReplyCalls[0]).toContain('@backend');

    // Chat output should include both the original text and the quickReply follow-up
    const lastChat = client.chatCalls[client.chatCalls.length - 1];
    expect(lastChat.text).toContain('Let me check.');
    expect(lastChat.text).toContain('Here are the schedules');
    expect(lastChat.text).not.toContain('<schedule-list');
  });

  it('schedule-list with no schedules feeds empty result via quickReply', async () => {
    const client = getClient(runner);
    adapter.handleResponse = 'Checking... <schedule-list />';
    adapter.quickReplyResponse = 'No scheduled tasks found.';

    const msg = makeChatMsg({ mentions: [runner.agentId], text: 'list schedules' });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 100));

    expect(adapter.quickReplyCalls.length).toBe(1);
    expect(adapter.quickReplyCalls[0]).toContain('[System] No schedules found.');
  });

  it('schedule-create feeds created ID back via quickReply', async () => {
    const client = getClient(runner);
    adapter.handleResponse = 'Done! <schedule-create name="ci-check" cron="*/30 * * * *" agent="@backend" title="CI Check" description="Check CI status" />';
    adapter.quickReplyResponse = 'Scheduled ci-check to run every 30 minutes.';

    const msg = makeChatMsg({ mentions: [runner.agentId], text: 'check CI every 30 min' });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 100));

    expect(adapter.quickReplyCalls.length).toBe(1);
    expect(adapter.quickReplyCalls[0]).toContain('[System] Schedule created:');
    expect(adapter.quickReplyCalls[0]).toContain('name="ci-check"');
    expect(adapter.quickReplyCalls[0]).toMatch(/id="sched-[a-z0-9]+"/);
  });

  it('schedule-delete feeds confirmation back via quickReply', async () => {
    const client = getClient(runner);
    client.schedulesStore.push({ id: 'sched-xyz' });
    adapter.handleResponse = 'Deleting. <schedule-delete id="sched-xyz" />';
    adapter.quickReplyResponse = 'Schedule deleted successfully.';

    const msg = makeChatMsg({ mentions: [runner.agentId], text: 'delete that schedule' });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 100));

    expect(adapter.quickReplyCalls.length).toBe(1);
    expect(adapter.quickReplyCalls[0]).toContain('[System] Schedule deleted: id="sched-xyz"');
    expect(client.deleteScheduleCalls).toContain('sched-xyz');
  });

  it('schedule command error is fed back via quickReply', async () => {
    const client = getClient(runner);
    (client as unknown as { createSchedule: () => Promise<never> }).createSchedule = async () => {
      throw new Error('server error');
    };

    adapter.handleResponse = 'Setting up... <schedule-create name="fail" cron="0 9 * * *" agent="@backend" title="Fail" description="fail" />';
    adapter.quickReplyResponse = 'Sorry, failed to create the schedule.';

    const msg = makeChatMsg({ mentions: [runner.agentId], text: 'schedule something' });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 100));

    expect(adapter.quickReplyCalls.length).toBe(1);
    expect(adapter.quickReplyCalls[0]).toContain('[System] Schedule create failed: server error');
  });

  it('falls back to pendingNotices when quickReply fails', async () => {
    const client = getClient(runner);
    client.schedulesStore.push({
      id: 'sched-123',
      name: 'nightly',
      cronExpr: '0 0 * * *',
      agentId: 'me',
      taskTemplate: { title: 'Nightly build', description: 'Run build' },
      enabled: true,
      createdBy: 'human-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    adapter.handleResponse = 'Let me check. <schedule-list />';
    // Make quickReply throw to trigger fallback
    adapter.quickReply = async () => { throw new Error('quickReply unavailable'); };

    const msg = makeChatMsg({ mentions: [runner.agentId], text: 'list schedules' });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 100));

    // Should fall back to pendingNotices
    const notices = (runner as unknown as { pendingNotices: string[] }).pendingNotices;
    expect(notices.length).toBe(1);
    expect(notices[0]).toContain('[System] Schedules (1)');
    expect(notices[0]).toContain('sched-123');
  });
});
