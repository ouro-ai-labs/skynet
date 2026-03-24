import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentType, MessageType, type Attachment, type SkynetMessage } from '@skynet-ai/protocol';

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
});
