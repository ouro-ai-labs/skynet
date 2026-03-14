import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { AgentType, MessageType, type SkynetMessage } from '@skynet-ai/protocol';

// We need to capture the mock instance created inside runChatPipe
// Use vi.hoisted so the factory can reference this array before imports run.
const { instances } = vi.hoisted(() => {
  return { instances: [] as Array<Record<string, unknown>> };
});

vi.mock('@skynet-ai/sdk', async () => {
  const { EventEmitter } = await import('node:events');

  class FakeClient extends EventEmitter {
    agent = { id: 'human-1', name: 'tester', type: 'human', capabilities: ['chat'], status: 'idle' };
    chatCalls: Array<{ text: string; mentions?: string[] }> = [];
    closed = false;

    constructor(_opts: unknown) {
      super();
      instances.push(this as unknown as Record<string, unknown>);
    }

    async connect() {
      return {
        members: [
          { id: 'agent-1', name: 'alice', type: 'claude-code', capabilities: [], status: 'idle' },
          { id: 'agent-2', name: 'bob', type: 'gemini-cli', capabilities: [], status: 'idle' },
        ],
        recentMessages: [],
      };
    }

    chat(text: string, mentions?: string[]) {
      this.chatCalls.push({ text, mentions });
    }

    async close() {
      this.closed = true;
    }
  }

  return { SkynetClient: FakeClient };
});

function lastClient() {
  return instances[instances.length - 1];
}

let stdoutChunks: string[];

beforeEach(() => {
  instances.length = 0;
  stdoutChunks = [];

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutChunks.push(chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function withFakeStdin<T>(lines: string[], fn: () => Promise<T>): Promise<T> {
  const fakeStdin = Readable.from(lines.map((l) => l + '\n'));
  const original = process.stdin;
  Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
  return fn().finally(() => {
    Object.defineProperty(process, 'stdin', { value: original, writable: true, configurable: true });
  });
}

describe('runChatPipe', () => {
  it('sends stdin lines as chat messages (server resolves mentions)', async () => {
    await withFakeStdin(['hello world', '@alice do something'], async () => {
      const { runChatPipe } = await import('../pipe.js');
      await runChatPipe({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });
    });

    const client = lastClient();
    const calls = client.chatCalls as Array<{ text: string; mentions?: string[] }>;
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toBe('hello world');
    expect(calls[1].text).toBe('@alice do something');
    // Mentions are resolved server-side, not by the client
    expect(calls[1].mentions).toBeUndefined();
  });

  it('closes client on stdin EOF', async () => {
    await withFakeStdin(['test'], async () => {
      const { runChatPipe } = await import('../pipe.js');
      await runChatPipe({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });
    });

    expect(lastClient().closed).toBe(true);
  });

  it('prints received messages to stdout', async () => {
    // Use a stdin that stays open until we push null
    const fakeStdin = new Readable({ read() {} });
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });

    try {
      const { runChatPipe } = await import('../pipe.js');

      const pipePromise = runChatPipe({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });

      // Wait a tick for the event listeners to be wired
      await new Promise((r) => setTimeout(r, 10));

      // Simulate an incoming message
      const msg: SkynetMessage = {
        id: 'msg-1',
        type: MessageType.CHAT,
        from: 'agent-1',
        timestamp: Date.now(),
        payload: { text: 'hello from alice' },
      };
      lastClient().emit('message', msg);

      // Close stdin to let the pipe finish
      fakeStdin.push(null);
      await pipePromise;

      const output = stdoutChunks.join('');
      expect(output).toContain('alice');
      expect(output).toContain('hello from alice');
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, writable: true, configurable: true });
    }
  });

  it('skips empty lines', async () => {
    await withFakeStdin(['', '  ', 'actual message'], async () => {
      const { runChatPipe } = await import('../pipe.js');
      await runChatPipe({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });
    });

    const calls = lastClient().chatCalls as Array<{ text: string }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('actual message');
  });

  it('sends @all without client-side resolution (server handles it)', async () => {
    await withFakeStdin(['@all attention please'], async () => {
      const { runChatPipe } = await import('../pipe.js');
      await runChatPipe({ serverUrl: 'http://localhost:3000', name: 'tester', id: 'human-1' });
    });

    const calls = lastClient().chatCalls as Array<{ text: string; mentions?: string[] }>;
    // @all is resolved server-side, not by the client
    expect(calls[0].mentions).toBeUndefined();
  });
});
