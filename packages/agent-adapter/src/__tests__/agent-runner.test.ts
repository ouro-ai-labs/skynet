import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType } from '@skynet/protocol';
import type { SkynetMessage, AgentCard, TaskPayload } from '@skynet/protocol';
import { AgentRunner } from '../agent-runner.js';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';
import { AgentType } from '@skynet/protocol';

// ── Mocks ──

vi.mock('@skynet/sdk', () => {
  const EventEmitter = require('node:events').EventEmitter;

  class MockSkynetClient extends EventEmitter {
    agent: AgentCard;
    chatCalls: Array<{ text: string; to: string | null }> = [];

    constructor(options: { agent: AgentCard }) {
      super();
      this.agent = options.agent;
    }

    async connect() {
      return { members: [], recentMessages: [] };
    }

    async close() {}

    chat(text: string, to: string | null = null) {
      this.chatCalls.push({ text, to });
    }

    sendMessage() {}
    updateTask() {}
    reportTaskResult() {}
  }

  return { SkynetClient: MockSkynetClient };
});

// ── Helpers ──

function makeChatMsg(overrides: Partial<{ from: string; text: string }> = {}): SkynetMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    type: MessageType.CHAT,
    from: overrides.from ?? 'human-1',
    to: null,
    timestamp: Date.now(),
    payload: { text: overrides.text ?? 'hello' },
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
  emit(event: string, ...args: unknown[]): boolean;
  chatCalls: Array<{ text: string; to: string | null }>;
}

function getClient(runner: AgentRunner): MockClient {
  return (runner as unknown as { client: MockClient }).client;
}

// ── Tests ──

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

  it('idle + chat message → normal handleMessage (no fork)', async () => {
    const client = getClient(runner);
    const msg = makeChatMsg();

    client.emit('chat', msg);

    // Allow async processing
    await new Promise(r => setTimeout(r, 10));

    expect(adapter.handleMessageCalls).toHaveLength(1);
    expect(adapter.quickReplyCalls).toHaveLength(0);
  });

  it('busy + chat + supportsQuickReply=true → uses quickReply', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(true);

    const client = getClient(runner);

    // First message makes runner busy
    const msg1 = makeChatMsg({ from: 'user-a', text: 'do something complex' });
    client.emit('chat', msg1);

    // Allow processQueue to start (but not finish due to delay)
    await new Promise(r => setTimeout(r, 10));

    // Second message arrives while busy
    const msg2 = makeChatMsg({ from: 'user-b', text: 'how is progress?' });
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

  it('busy + chat + supportsQuickReply=false → queues normally', async () => {
    adapter.handleDelay = 100;
    adapter.setSupportsQuickReply(false);

    const client = getClient(runner);

    const msg1 = makeChatMsg({ from: 'user-a', text: 'first' });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    const msg2 = makeChatMsg({ from: 'user-b', text: 'second' });
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

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work' });
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

    const msg1 = makeChatMsg({ from: 'user-a', text: 'work' });
    client.emit('chat', msg1);
    await new Promise(r => setTimeout(r, 10));

    const msg2 = makeChatMsg({ from: 'user-b', text: 'status?' });
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
});
