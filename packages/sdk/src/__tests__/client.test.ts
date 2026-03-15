import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { SkynetClient } from '../client.js';
import { AgentType, WS_CLOSE_REPLACED } from '@skynet-ai/protocol';

let port = 19870;
function nextPort(): number {
  return port++;
}

function createJoinHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'join') {
        ws.send(JSON.stringify({
          event: 'workspace.state',
          data: { members: [], recentMessages: [] },
        }));
      }
    });
  });
}

function createTestClient(p: number, overrides: Record<string, unknown> = {}): SkynetClient {
  return new SkynetClient({
    serverUrl: `http://localhost:${p}`,
    agent: {
      id: 'test-agent',
      name: 'Test',
      type: AgentType.HUMAN,
      capabilities: ['chat'],
      status: 'idle',
    },
    reconnect: true,
    reconnectInterval: 100,
    maxReconnectInterval: 1600,
    ...overrides,
  });
}

function closeServer(wss: WebSocketServer): Promise<void> {
  // Terminate all connected clients first, otherwise wss.close() hangs
  for (const client of wss.clients) {
    client.terminate();
  }
  return new Promise((resolve) => wss.close(() => resolve()));
}

describe('SkynetClient reconnection', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanups) {
      await fn();
    }
    cleanups.length = 0;
  });

  it('caps delay at maxReconnectInterval', () => {
    const p = nextPort();
    const client = createTestClient(p);
    const delays: number[] = [];
    client.on('reconnecting', (info: { attempt: number; delay: number }) => {
      delays.push(info.delay);
    });

    const scheduleReconnect = (client as unknown as { scheduleReconnect: () => void }).scheduleReconnect.bind(client);

    vi.useFakeTimers();
    for (let i = 0; i < 7; i++) {
      scheduleReconnect();
    }
    vi.useRealTimers();

    client.close();

    expect(delays).toEqual([100, 200, 400, 800, 1600, 1600, 1600]);
  });

  it('emits reconnecting with attempt number and increasing delay', async () => {
    const p = nextPort();
    const wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);

    const client = createTestClient(p);
    cleanups.push(() => client.close());
    await client.connect();
    expect(client.connected).toBe(true);

    const reconnectEvents: Array<{ attempt: number; delay: number }> = [];
    client.on('reconnecting', (info: { attempt: number; delay: number }) => {
      reconnectEvents.push(info);
    });

    await closeServer(wss);

    // Wait for a few reconnect attempts (100 + 200 + 400 = 700ms)
    await new Promise((r) => setTimeout(r, 1200));

    expect(reconnectEvents.length).toBeGreaterThanOrEqual(2);
    expect(reconnectEvents[0]!).toEqual({ attempt: 1, delay: 100 });
    expect(reconnectEvents[1]!).toEqual({ attempt: 2, delay: 200 });
  }, 10000);

  it('only emits one disconnected event across reconnect cycles', async () => {
    const p = nextPort();
    const wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);

    const client = createTestClient(p);
    cleanups.push(() => client.close());
    await client.connect();

    let disconnectCount = 0;
    let errorCount = 0;
    client.on('disconnected', () => { disconnectCount++; });
    client.on('error', () => { errorCount++; });

    await closeServer(wss);

    await new Promise((r) => setTimeout(r, 1200));

    expect(disconnectCount).toBe(1);
    expect(errorCount).toBe(0);
  }, 10000);

  it('does not reconnect when reconnect option is false', async () => {
    const p = nextPort();
    const wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);

    const client = createTestClient(p, { reconnect: false });
    cleanups.push(() => client.close());
    await client.connect();

    let reconnectCount = 0;
    client.on('reconnecting', () => { reconnectCount++; });

    await closeServer(wss);

    await new Promise((r) => setTimeout(r, 500));

    expect(reconnectCount).toBe(0);
  }, 10000);

  it('cleans up old WebSocket when connect() is called again', async () => {
    const p = nextPort();
    const wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);
    cleanups.push(() => closeServer(wss));

    const client = createTestClient(p, { reconnect: false });
    cleanups.push(() => client.close());
    await client.connect();
    expect(client.connected).toBe(true);

    // Access the internal ws to verify cleanup
    const oldWs = (client as unknown as { ws: { readyState: number } }).ws;

    // Call connect() again (simulating what scheduleReconnect does)
    await client.connect();
    expect(client.connected).toBe(true);

    const newWs = (client as unknown as { ws: { readyState: number } }).ws;

    // Old WebSocket should have been terminated
    expect(oldWs).not.toBe(newWs);
    // readyState 2=CLOSING, 3=CLOSED
    expect(oldWs.readyState).toBeGreaterThanOrEqual(2);
  }, 10000);

  it('resets backoff after successful reconnection', async () => {
    const p = nextPort();
    let wss: WebSocketServer | null = new WebSocketServer({ port: p });
    createJoinHandler(wss);

    const client = createTestClient(p);
    cleanups.push(() => client.close());
    await client.connect();

    const reconnectEvents: Array<{ attempt: number; delay: number }> = [];
    client.on('reconnecting', (info: { attempt: number; delay: number }) => {
      reconnectEvents.push(info);
    });

    await closeServer(wss);

    // Wait for first reconnect attempt to fire
    await new Promise((r) => setTimeout(r, 250));

    // Restart server
    wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);
    cleanups.push(() => closeServer(wss!));

    // Wait for successful reconnection
    await new Promise((r) => setTimeout(r, 1000));

    expect(client.connected).toBe(true);
    expect(reconnectEvents[0]!.delay).toBe(100);
  }, 10000);

  it('does not reconnect when server closes with WS_CLOSE_REPLACED (4001)', async () => {
    const p = nextPort();
    const wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);
    cleanups.push(() => closeServer(wss));

    const client = createTestClient(p);
    cleanups.push(() => client.close());
    await client.connect();

    let reconnectCount = 0;
    let replacedCount = 0;
    client.on('reconnecting', () => { reconnectCount++; });
    client.on('replaced', () => { replacedCount++; });

    // Server closes the socket with the "replaced" close code
    for (const ws of wss.clients) {
      ws.close(WS_CLOSE_REPLACED, 'replaced');
    }

    await new Promise((r) => setTimeout(r, 500));

    expect(reconnectCount).toBe(0);
    expect(replacedCount).toBe(1);
    expect(client.connected).toBe(false);
  }, 10000);

  it('emits debug event on reconnection failure', async () => {
    const p = nextPort();
    const wss = new WebSocketServer({ port: p });
    createJoinHandler(wss);

    const client = createTestClient(p);
    cleanups.push(() => client.close());
    await client.connect();

    const debugMessages: string[] = [];
    client.on('debug', (msg: string) => {
      debugMessages.push(msg);
    });

    await closeServer(wss);

    // Wait for reconnect attempt to fail
    await new Promise((r) => setTimeout(r, 500));

    expect(debugMessages.length).toBeGreaterThanOrEqual(1);
    expect(debugMessages[0]).toContain('Reconnect attempt');
    expect(debugMessages[0]).toContain('failed');
  }, 10000);
});
