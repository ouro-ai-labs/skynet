import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkynetServer, SqliteStore } from '@skynet/server';
import { SkynetClient } from '@skynet/sdk';
import { AgentType, MessageType, type SkynetMessage, type TaskPayload } from '@skynet/protocol';
import { AgentRunner } from '../agent-runner.js';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';
import { randomUUID } from 'node:crypto';

// ── FakeAdapter: echoes messages with a label prefix ──

class FakeAdapter extends AgentAdapter {
  readonly type = AgentType.CLAUDE_CODE;
  readonly name = 'fake';

  constructor(private label: string) {
    super();
  }

  async isAvailable() {
    return true;
  }

  async handleMessage(msg: SkynetMessage): Promise<string> {
    const text = (msg.payload as { text: string }).text;
    return `[${this.label}] echo: ${text}`;
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    return { success: true, summary: `[${this.label}] task done` };
  }

  async dispose() {}
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collectMessages(
  client: SkynetClient,
  count: number,
  selfId: string,
  timeoutMs = 3000,
): Promise<SkynetMessage[]> {
  return new Promise((resolve, reject) => {
    const collected: SkynetMessage[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${count} messages, got ${collected.length}: ${JSON.stringify(collected.map((m) => (m.payload as { text: string }).text))}`,
        ),
      );
    }, timeoutMs);

    const handler = (msg: SkynetMessage) => {
      if (msg.from === selfId) return;
      collected.push(msg);
      if (collected.length >= count) {
        cleanup();
        resolve(collected);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      client.off('chat', handler);
    };

    client.on('chat', handler);
  });
}

// ── E2E Tests ──

const PORT = 4300 + Math.floor(Math.random() * 100);

describe('E2E: multi-agent collaboration', () => {
  let server: SkynetServer;
  let roomId: string;
  let runner1: AgentRunner;
  let runner2: AgentRunner;
  let humanClient: SkynetClient;

  beforeAll(async () => {
    // Start server
    server = new SkynetServer({ port: PORT, store: new SqliteStore(':memory:') });
    await server.start();

    // Create room via API
    const res = await fetch(`http://localhost:${PORT}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'e2e-test-room' }),
    });
    const body = (await res.json()) as { id: string };
    roomId = body.id;

    // Create 2 AgentRunners with FakeAdapters
    runner1 = new AgentRunner({
      serverUrl: `http://localhost:${PORT}`,
      roomId,
      adapter: new FakeAdapter('agent-1'),
      agentName: 'agent-1',
    });
    runner2 = new AgentRunner({
      serverUrl: `http://localhost:${PORT}`,
      roomId,
      adapter: new FakeAdapter('agent-2'),
      agentName: 'agent-2',
    });

    await runner1.start();
    await runner2.start();

    // Create human client
    humanClient = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: {
        id: randomUUID(),
        name: 'human',
        type: AgentType.HUMAN,
      },
      roomId,
      reconnect: false,
    });
    await humanClient.connect();

    // Let connections stabilize
    await sleep(100);
  });

  afterAll(async () => {
    await humanClient.close();
    await runner1.stop();
    await runner2.stop();
    await server.stop();
  });

  it('all participants are connected to the room', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/rooms/${roomId}/members`);
    const members = (await res.json()) as Array<{ name: string }>;
    expect(members).toHaveLength(3);
    const names = members.map((m) => m.name).sort();
    expect(names).toEqual(['agent-1', 'agent-2', 'human']);
  });

  it('human broadcast reaches both agents who respond', async () => {
    const pending = collectMessages(humanClient, 2, humanClient.agent.id);
    humanClient.chat('Hello everyone!');

    const messages = await pending;
    const texts = messages.map((m) => (m.payload as { text: string }).text).sort();

    expect(texts).toEqual([
      '[agent-1] echo: Hello everyone!',
      '[agent-2] echo: Hello everyone!',
    ]);
  });

  it('human DM to agent-1 gets response only from agent-1', async () => {
    const pending = collectMessages(humanClient, 1, humanClient.agent.id);
    humanClient.chat('Question for agent-1', runner1.agentId);

    const messages = await pending;
    expect(messages).toHaveLength(1);
    expect((messages[0].payload as { text: string }).text).toBe(
      '[agent-1] echo: Question for agent-1',
    );
  });

  it('human DM to agent-2 gets response only from agent-2', async () => {
    const pending = collectMessages(humanClient, 1, humanClient.agent.id);
    humanClient.chat('Question for agent-2', runner2.agentId);

    const messages = await pending;
    expect(messages).toHaveLength(1);
    expect((messages[0].payload as { text: string }).text).toBe(
      '[agent-2] echo: Question for agent-2',
    );
  });

  it('all messages are persisted', async () => {
    // Wait for any in-flight messages to settle
    await sleep(200);

    const res = await fetch(`http://localhost:${PORT}/api/rooms/${roomId}/messages`);
    const messages = (await res.json()) as Array<{ type: string }>;

    // We expect: 3 join messages + 3 broadcasts (human + 2 echoes) + 2 DMs (human + echo) + 2 DMs (human + echo) = 12 minimum
    // The exact count depends on implementation, but should be at least 10
    expect(messages.length).toBeGreaterThanOrEqual(10);
  });
});
