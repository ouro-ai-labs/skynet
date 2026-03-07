import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MessageType, MENTION_ALL } from '@skynet/protocol';
import type { SkynetMessage, AgentCard, TaskPayload } from '@skynet/protocol';
import { AgentRunner } from '../agent-runner.js';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';
import { AgentType } from '@skynet/protocol';
import { buildSkynetIntro } from '../skynet-intro.js';

// ── Mocks ──

vi.mock('@skynet/sdk', () => {
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

    async connect() {
      return { members: [], recentMessages: [] };
    }

    async close() {}

    chat(text: string, mentions?: string[]) {
      this.chatCalls.push({ text, mentions });
    }

    sendMessage() {}
    updateTask() {}
    reportTaskResult() {}
  }

  return { SkynetClient: MockSkynetClient };
});

// ── Helpers ──

function makeChatMsg(overrides: Partial<{ from: string; text: string; to: string | null; mentions: string[] }> = {}): SkynetMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    type: MessageType.CHAT,
    from: overrides.from ?? 'human-1',
    to: overrides.to ?? null,
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
    to: null,
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

  quickReplyCalls: string[] = [];
  handleMessageCalls: SkynetMessage[] = [];

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

  async isAvailable() { return true; }

  async handleMessage(msg: SkynetMessage): Promise<string> {
    this.handleMessageCalls.push(msg);
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
}

// ── Helper to access internal client ──

interface MockClient {
  agent: AgentCard;
  emit(event: string, ...args: unknown[]): boolean;
  chatCalls: Array<{ text: string; mentions?: string[] }>;
}

function getClient(runner: AgentRunner): MockClient {
  return (runner as unknown as { client: MockClient }).client;
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
    expect(intro).toContain('NO_REPLY');
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
      to: null,
      timestamp: Date.now(),
      payload: { agent: { id: 'new-1', name: 'newcomer', type: 'claude-code' } },
    });

    // Send a chat message — should include the join notice
    const msg = makeChatMsg({ from: 'user-a', text: 'hello', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    expect(adapter.handleMessageCalls).toHaveLength(1);
    const receivedText = (adapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(receivedText).toContain('[System] newcomer has joined the workspace.');
    expect(receivedText).toContain('hello');
  });

  it('piggybacks leave notice onto next message', async () => {
    const client = getClient(runner);

    // First register the agent in member names
    client.emit('agent-join', {
      id: 'join-msg-2',
      type: 'agent.join',
      from: 'server',
      to: null,
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
      to: null,
      timestamp: Date.now(),
      payload: { agentId: 'leaving-1' },
    });

    // Send another message — should include the leave notice
    const msg2 = makeChatMsg({ from: 'user-a', text: 'second', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 50));

    expect(adapter.handleMessageCalls).toHaveLength(2);
    const receivedText = (adapter.handleMessageCalls[1].payload as { text: string }).text;
    expect(receivedText).toContain('[System] leaver has left the workspace.');
    expect(receivedText).toContain('second');
  });

  it('no notices means original message text is unchanged', async () => {
    const client = getClient(runner);

    const msg = makeChatMsg({ from: 'user-a', text: 'clean message', mentions: [runner.agentId] });
    client.emit('chat', msg);
    await new Promise(r => setTimeout(r, 50));

    const receivedText = (adapter.handleMessageCalls[0].payload as { text: string }).text;
    expect(receivedText).toBe('clean message');
  });

  it('clears notices generated during start()', async () => {
    // Create a fresh runner and simulate join events during connection
    const freshAdapter = new FakeAdapter();
    const freshRunner = new AgentRunner({
      serverUrl: 'ws://localhost:0',
      adapter: freshAdapter,
      agentName: 'fresh-agent',
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

  it('busy + @mentioned chat + supportsQuickReply=true → uses quickReply', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    const client = getClient(runner);

    // First message makes runner busy
    const msg1 = makeChatMsg({ from: 'user-a', text: 'do something complex', mentions: [runner.agentId] });
    client.emit('chat', msg1);

    // Allow processQueue to start (but not finish due to delay)
    await new Promise(r => setTimeout(r, 10));

    // Second message arrives while busy — @mentioned this agent
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

  it('busy + @mentioned via mentions array → forks', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work', mentions: [runner.agentId] });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    // Message mentions this agent (via mentions array)
    const msg2 = makeChatMsg({ from: 'user-b', text: 'hey agent', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.quickReplyCalls).toHaveLength(1);

    await new Promise(r => setTimeout(r, 150));
  });

  it('busy + max 1 concurrent fork → second @mention queues', async () => {
    adapter.handleDelay = 200;
    adapter.setSupportsQuickReply(true);

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

    // Second message: @mentioned → should fork
    const msg2 = makeChatMsg({ from: 'user-b', text: 'first mention', mentions: [runner.agentId] });
    client.emit('chat', msg2);
    await new Promise(r => setTimeout(r, 10));

    // Third message: @mentioned → fork in progress, should queue
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

    // @mentioned — will attempt fork
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

    await new Promise(r => setTimeout(r, 400));

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
    });
    await runner.start();

    // The client should have been constructed with the persisted timestamp
    const client = getClient(runner);
    expect((client as unknown as { lastSeenTimestamp: number }).lastSeenTimestamp).toBe(99000);
  });
});
