import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentType, MessageType, MENTION_ALL, type Attachment, type SkynetMessage } from '@skynet-ai/protocol';

// --- Mock SkynetClient ---
const { clientInstances } = vi.hoisted(() => {
  return { clientInstances: [] as Array<Record<string, unknown>> };
});

vi.mock('@skynet-ai/sdk', async () => {
  const { EventEmitter } = await import('node:events');

  class FakeClient extends EventEmitter {
    agent = { id: 'human-1', name: 'tester', type: 'human', capabilities: ['chat'], status: 'idle' };
    chatCalls: Array<{ text: string; mentions?: string[]; attachments?: Attachment[] }> = [];
    closed = false;

    constructor(_opts: unknown) {
      super();
      clientInstances.push(this as unknown as Record<string, unknown>);
    }

    async connect() {
      return {
        members: [
          { id: 'agent-1', name: 'alice', type: 'claude-code', capabilities: [], status: 'idle' },
        ],
        recentMessages: [],
      };
    }

    chat(text: string, mentions?: string[], attachments?: Attachment[]) {
      this.chatCalls.push({ text, mentions, attachments });
    }

    async close() {
      this.closed = true;
    }
  }

  return { SkynetClient: FakeClient };
});

// --- Mock WeixinBot ---
const { botInstances } = vi.hoisted(() => {
  return { botInstances: [] as Array<Record<string, unknown>> };
});

vi.mock('@pinixai/weixin-bot', () => {
  class FakeBot {
    messageHandler: ((msg: Record<string, unknown>) => Promise<void>) | null = null;
    sendCalls: Array<{ userId: string; text: string }> = [];
    typingCalls: Array<{ userId: string; action: string }> = [];
    loggedIn = false;
    running = false;
    stopped = false;

    constructor() {
      botInstances.push(this as unknown as Record<string, unknown>);
    }

    async login() {
      this.loggedIn = true;
    }

    onMessage(handler: (msg: Record<string, unknown>) => Promise<void>) {
      this.messageHandler = handler;
    }

    async send(userId: string, text: string) {
      this.sendCalls.push({ userId, text });
    }

    async sendTyping(userId: string) {
      this.typingCalls.push({ userId, action: 'typing' });
    }

    async stopTyping(userId: string) {
      this.typingCalls.push({ userId, action: 'stop' });
    }

    async run() {
      this.running = true;
      // Resolve immediately in tests
    }

    async stop() {
      this.stopped = true;
    }
  }

  return { WeixinBot: FakeBot };
});

function lastClient() {
  return clientInstances[clientInstances.length - 1];
}

function lastBot() {
  return botInstances[botInstances.length - 1];
}

beforeEach(() => {
  clientInstances.length = 0;
  botInstances.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AbortSignal.any polyfill', () => {
  it('installs polyfill when AbortSignal.any is missing', async () => {
    const original = AbortSignal.any;
    // Simulate Node < 22 by removing AbortSignal.any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (AbortSignal as any).any;
    try {
      const { runChatWeixin } = await import('../weixin.js');
      await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });
      expect(typeof AbortSignal.any).toBe('function');

      // Verify polyfill works: propagates abort from one signal
      const controller = new AbortController();
      const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
      expect(combined.aborted).toBe(false);
      controller.abort(new Error('test'));
      expect(combined.aborted).toBe(true);
      expect((combined.reason as Error).message).toBe('test');
    } finally {
      AbortSignal.any = original;
    }
  });

  it('handles already-aborted signals', async () => {
    const original = AbortSignal.any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (AbortSignal as any).any;
    try {
      const { runChatWeixin } = await import('../weixin.js');
      await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

      const aborted = AbortSignal.abort(new Error('pre-aborted'));
      const combined = AbortSignal.any([aborted, AbortSignal.timeout(60_000)]);
      expect(combined.aborted).toBe(true);
      expect((combined.reason as Error).message).toBe('pre-aborted');
    } finally {
      AbortSignal.any = original;
    }
  });
});

describe('runChatWeixin', () => {
  it('forwards WeChat messages to Skynet workspace', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;
    expect(handler).toBeTruthy();

    await handler({ userId: 'wx-user-1', text: 'hello @alice' });

    const calls = client.chatCalls as Array<{ text: string }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('hello @alice');
  });

  it('forwards Skynet messages to WeChat', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    // First, establish the WeChat userId by sending a message
    await handler({ userId: 'wx-user-1', text: 'hi' });

    // Simulate an incoming Skynet message
    const msg: SkynetMessage = {
      id: 'msg-1',
      type: MessageType.CHAT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { text: 'Hello from Alice' },
    };
    client.emit('message', msg);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 10));

    const sends = bot.sendCalls as Array<{ userId: string; text: string }>;
    expect(sends.length).toBeGreaterThanOrEqual(1);
    expect(sends[0].userId).toBe('wx-user-1');
    expect(sends[0].text).toContain('alice');
    expect(sends[0].text).toContain('Hello from Alice');
  });

  it('does not echo own messages back to WeChat', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    // Establish WeChat userId
    await handler({ userId: 'wx-user-1', text: 'hi' });

    // Simulate own message coming back from workspace
    const msg: SkynetMessage = {
      id: 'msg-2',
      type: MessageType.CHAT,
      from: 'human-1', // Same as our own ID
      timestamp: Date.now(),
      payload: { text: 'hi' },
    };
    client.emit('message', msg);

    await new Promise((r) => setTimeout(r, 10));

    const sends = bot.sendCalls as Array<{ userId: string; text: string }>;
    expect(sends).toHaveLength(0);
  });

  it('skips empty WeChat messages', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    await handler({ userId: 'wx-user-1', text: '  ' });

    const calls = client.chatCalls as Array<{ text: string }>;
    expect(calls).toHaveLength(0);
  });

  it('sends typing indicator when agent is busy', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    // Establish WeChat userId
    await handler({ userId: 'wx-user-1', text: 'hi' });

    // Simulate status change
    client.emit('status-change', { agentId: 'agent-1', status: 'busy' });
    await new Promise((r) => setTimeout(r, 10));

    const typingCalls = bot.typingCalls as Array<{ userId: string; action: string }>;
    expect(typingCalls).toContainEqual({ userId: 'wx-user-1', action: 'typing' });

    client.emit('status-change', { agentId: 'agent-1', status: 'idle' });
    await new Promise((r) => setTimeout(r, 10));

    expect(typingCalls).toContainEqual({ userId: 'wx-user-1', action: 'stop' });
  });

  it('tracks member changes from agent-join and agent-leave', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    // Establish WeChat userId
    await handler({ userId: 'wx-user-1', text: 'hi' });

    // Simulate agent join
    const joinMsg: SkynetMessage = {
      id: 'join-1',
      type: MessageType.AGENT_JOIN,
      from: 'system',
      timestamp: Date.now(),
      payload: { agent: { id: 'agent-2', name: 'bob', type: AgentType.GEMINI_CLI, capabilities: [], status: 'idle' } },
    };
    client.emit('agent-join', joinMsg);
    client.emit('message', joinMsg);

    await new Promise((r) => setTimeout(r, 10));

    const sends = bot.sendCalls as Array<{ userId: string; text: string }>;
    expect(sends.some((s) => s.text.includes('bob') && s.text.includes('joined'))).toBe(true);
  });

  it('logs in to WeChat bot', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    expect(bot.loggedIn).toBe(true);
    expect(bot.running).toBe(true);
  });

  it('forwards WeChat image messages to Skynet as attachments', async () => {
    // Mock fetch to return a small PNG-like buffer
    const fakeImageData = Buffer.from('fake-png-data');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => fakeImageData.buffer.slice(
        fakeImageData.byteOffset,
        fakeImageData.byteOffset + fakeImageData.byteLength,
      ),
    } as Response);

    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    await handler({
      userId: 'wx-user-1',
      text: 'https://example.com/img.png',
      type: 'image',
      raw: {
        item_list: [
          {
            type: 2,
            image_item: { media: { encrypt_query_param: '', aes_key: '' }, url: 'https://example.com/img.png' },
          },
        ],
      },
      _contextToken: 'ctx-1',
      timestamp: new Date(),
    });

    const calls = client.chatCalls as Array<{ text: string; attachments?: Attachment[] }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].attachments).toHaveLength(1);
    expect(calls[0].attachments![0].type).toBe('image');
    expect(calls[0].attachments![0].mimeType).toBe('image/png');
    expect(calls[0].attachments![0].data).toBe(fakeImageData.toString('base64'));

    fetchSpy.mockRestore();
  });

  it('skips image messages when URL is missing', async () => {
    const { runChatWeixin } = await import('../weixin.js');
    await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

    const bot = lastBot();
    const client = lastClient();
    const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

    await handler({
      userId: 'wx-user-1',
      text: '[image]',
      type: 'image',
      raw: {
        item_list: [{ type: 2, image_item: { media: { encrypt_query_param: '', aes_key: '' } } }],
      },
      _contextToken: 'ctx-1',
      timestamp: new Date(),
    });

    const calls = client.chatCalls as Array<{ text: string }>;
    expect(calls).toHaveLength(0);
  });

  describe('last mention default', () => {
    it('reuses last mentions when sending without @mention in multi-agent workspace', async () => {
      const { runChatWeixin } = await import('../weixin.js');
      await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

      const bot = lastBot();
      const client = lastClient();
      const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

      // Add a second agent so auto-mention (1:1 mode) doesn't kick in
      const joinMsg: SkynetMessage = {
        id: 'join-1',
        type: MessageType.AGENT_JOIN,
        from: 'system',
        timestamp: Date.now(),
        payload: { agent: { id: 'agent-2', name: 'bob', type: AgentType.GEMINI_CLI, capabilities: [], status: 'idle' } },
      };
      client.emit('agent-join', joinMsg);

      // Send a message with explicit @mention
      await handler({ userId: 'wx-user-1', text: 'hello @alice' });

      // Simulate the echoed message from server with resolved mentions
      const echoMsg: SkynetMessage = {
        id: 'echo-1',
        type: MessageType.CHAT,
        from: 'human-1',
        timestamp: Date.now(),
        payload: { text: 'hello @alice' },
        mentions: ['agent-1'],
      };
      client.emit('message', echoMsg);
      await new Promise((r) => setTimeout(r, 10));

      // Now send a message without @mention — should reuse last mentions
      await handler({ userId: 'wx-user-1', text: 'what do you think?' });

      const calls = client.chatCalls as Array<{ text: string; mentions?: string[] }>;
      expect(calls).toHaveLength(2);
      // First message: has @, so mentions should be undefined (server resolves)
      expect(calls[0].mentions).toBeUndefined();
      // Second message: no @, should default to last mentions
      expect(calls[1].mentions).toEqual(['agent-1']);
    });

    it('does not reuse MENTION_ALL as last mentions', async () => {
      const { runChatWeixin } = await import('../weixin.js');
      await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

      const bot = lastBot();
      const client = lastClient();
      const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

      // Add a second agent
      const joinMsg: SkynetMessage = {
        id: 'join-1',
        type: MessageType.AGENT_JOIN,
        from: 'system',
        timestamp: Date.now(),
        payload: { agent: { id: 'agent-2', name: 'bob', type: AgentType.GEMINI_CLI, capabilities: [], status: 'idle' } },
      };
      client.emit('agent-join', joinMsg);

      await handler({ userId: 'wx-user-1', text: 'hello @all' });

      // Simulate echoed message with only MENTION_ALL
      const echoMsg: SkynetMessage = {
        id: 'echo-1',
        type: MessageType.CHAT,
        from: 'human-1',
        timestamp: Date.now(),
        payload: { text: 'hello @all' },
        mentions: [MENTION_ALL],
      };
      client.emit('message', echoMsg);
      await new Promise((r) => setTimeout(r, 10));

      // Send without @mention — should NOT reuse @all
      await handler({ userId: 'wx-user-1', text: 'follow up' });

      const calls = client.chatCalls as Array<{ text: string; mentions?: string[] }>;
      expect(calls).toHaveLength(2);
      expect(calls[1].mentions).toBeUndefined();
    });

    it('updates last mentions when a new @mention is used', async () => {
      const { runChatWeixin } = await import('../weixin.js');
      await runChatWeixin({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

      const bot = lastBot();
      const client = lastClient();
      const handler = bot.messageHandler as (msg: Record<string, unknown>) => Promise<void>;

      // Add a second agent
      const joinMsg: SkynetMessage = {
        id: 'join-1',
        type: MessageType.AGENT_JOIN,
        from: 'system',
        timestamp: Date.now(),
        payload: { agent: { id: 'agent-2', name: 'bob', type: AgentType.GEMINI_CLI, capabilities: [], status: 'idle' } },
      };
      client.emit('agent-join', joinMsg);

      // First mention alice
      await handler({ userId: 'wx-user-1', text: 'hello @alice' });
      client.emit('message', {
        id: 'echo-1', type: MessageType.CHAT, from: 'human-1',
        timestamp: Date.now(), payload: { text: 'hello @alice' }, mentions: ['agent-1'],
      } as SkynetMessage);
      await new Promise((r) => setTimeout(r, 10));

      // Then mention bob
      await handler({ userId: 'wx-user-1', text: 'hey @bob' });
      client.emit('message', {
        id: 'echo-2', type: MessageType.CHAT, from: 'human-1',
        timestamp: Date.now(), payload: { text: 'hey @bob' }, mentions: ['agent-2'],
      } as SkynetMessage);
      await new Promise((r) => setTimeout(r, 10));

      // Send without @mention — should use bob (the latest)
      await handler({ userId: 'wx-user-1', text: 'and one more thing' });

      const calls = client.chatCalls as Array<{ text: string; mentions?: string[] }>;
      expect(calls).toHaveLength(3);
      expect(calls[2].mentions).toEqual(['agent-2']);
    });
  });
});
