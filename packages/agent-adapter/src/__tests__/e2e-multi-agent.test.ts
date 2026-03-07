import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkynetWorkspace, SqliteStore } from '@skynet/workspace';
import { SkynetClient } from '@skynet/sdk';
import { AgentType, MessageType, type SkynetMessage, type TaskPayload, type AgentCard } from '@skynet/protocol';
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
  let server: SkynetWorkspace;
  let runner1: AgentRunner;
  let runner2: AgentRunner;
  let humanClient: SkynetClient;

  beforeAll(async () => {
    // Start server
    server = new SkynetWorkspace({ port: PORT, store: new SqliteStore(':memory:'), disconnectGraceMs: 100 });
    await server.start();

    // Create 2 AgentRunners with FakeAdapters
    runner1 = new AgentRunner({
      serverUrl: `http://localhost:${PORT}`,
      adapter: new FakeAdapter('agent-1'),
      agentName: 'agent-1',
    });
    runner2 = new AgentRunner({
      serverUrl: `http://localhost:${PORT}`,
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

  it('all participants are connected to the workspace', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/members`);
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

    const res = await fetch(`http://localhost:${PORT}/api/messages`);
    const messages = (await res.json()) as Array<{ type: string }>;

    // We expect: 3 join messages + 3 broadcasts (human + 2 echoes) + 2 DMs (human + echo) + 2 DMs (human + echo) = 12 minimum
    expect(messages.length).toBeGreaterThanOrEqual(10);
  });
});

describe('E2E: full lifecycle (API create → connect → chat → disconnect)', () => {
  let server: SkynetWorkspace;
  const LIFECYCLE_PORT = 4300 + Math.floor(Math.random() * 100) + 100;

  beforeAll(async () => {
    server = new SkynetWorkspace({ port: LIFECYCLE_PORT, store: new SqliteStore(':memory:'), disconnectGraceMs: 100 });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('creates agents via API, connects them, chats, and verifies cleanup on disconnect', async () => {
    const baseUrl = `http://localhost:${LIFECYCLE_PORT}`;

    // 1. Create agents via REST API
    const createAgent1 = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'lifecycle-agent-1', type: 'claude-code', role: 'backend' }),
    });
    expect(createAgent1.status).toBe(201);
    const agent1Profile = await createAgent1.json() as AgentCard;

    const createAgent2 = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'lifecycle-agent-2', type: 'gemini-cli', role: 'frontend' }),
    });
    expect(createAgent2.status).toBe(201);

    const createHuman = await fetch(`${baseUrl}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'lifecycle-human' }),
    });
    expect(createHuman.status).toBe(201);

    // 2. Verify entities exist via list APIs
    const agentsRes = await fetch(`${baseUrl}/api/agents`);
    const agents = await agentsRes.json() as AgentCard[];
    expect(agents).toHaveLength(2);

    const humansRes = await fetch(`${baseUrl}/api/humans`);
    const humans = await humansRes.json() as Array<{ name: string }>;
    expect(humans).toHaveLength(1);

    // 3. Connect agents and human via WebSocket
    const runner = new AgentRunner({
      serverUrl: baseUrl,
      adapter: new FakeAdapter('lifecycle-1'),
      agentName: 'lifecycle-agent-1',
    });
    await runner.start();

    const humanClient = new SkynetClient({
      serverUrl: baseUrl,
      agent: {
        id: randomUUID(),
        name: 'lifecycle-human',
        type: AgentType.HUMAN,
      },
      reconnect: false,
    });
    const state = await humanClient.connect();

    // Should see both members
    expect(state.members.length).toBeGreaterThanOrEqual(2);

    await sleep(100);

    // 4. Verify members API
    const membersRes = await fetch(`${baseUrl}/api/members`);
    const members = await membersRes.json() as Array<{ name: string }>;
    expect(members.some(m => m.name === 'lifecycle-agent-1')).toBe(true);
    expect(members.some(m => m.name === 'lifecycle-human')).toBe(true);

    // 5. Chat and verify response
    const pending = collectMessages(humanClient, 1, humanClient.agent.id);
    humanClient.chat('lifecycle test');
    const responses = await pending;
    expect((responses[0].payload as { text: string }).text).toBe('[lifecycle-1] echo: lifecycle test');

    // 6. Disconnect agent and verify leave
    const leavePromise = new Promise<void>((resolve) => {
      humanClient.on('agent-leave', () => resolve());
    });
    await runner.stop();
    await leavePromise;

    // 7. Verify members API reflects the disconnect
    await sleep(100);
    const membersAfter = await fetch(`${baseUrl}/api/members`);
    const membersAfterList = await membersAfter.json() as Array<{ name: string }>;
    expect(membersAfterList.some(m => m.name === 'lifecycle-agent-1')).toBe(false);
    expect(membersAfterList.some(m => m.name === 'lifecycle-human')).toBe(true);

    // 8. Verify messages are persisted
    const msgsRes = await fetch(`${baseUrl}/api/messages`);
    const msgs = await msgsRes.json() as Array<{ type: string }>;
    const types = msgs.map(m => m.type);
    expect(types).toContain('agent.join');
    expect(types).toContain('chat');
    expect(types).toContain('agent.leave');

    await humanClient.close();
  });
});

describe('E2E: heartbeat updates agent status', () => {
  let server: SkynetWorkspace;
  const HB_PORT = 4300 + Math.floor(Math.random() * 100) + 200;

  beforeAll(async () => {
    server = new SkynetWorkspace({ port: HB_PORT, store: new SqliteStore(':memory:'), disconnectGraceMs: 100 });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('heartbeat updates status visible via members API', async () => {
    const client = new SkynetClient({
      serverUrl: `http://localhost:${HB_PORT}`,
      agent: {
        id: randomUUID(),
        name: 'hb-agent',
        type: AgentType.GENERIC,
        status: 'idle',
      },
      reconnect: false,
      heartbeatInterval: 100,
    });
    await client.connect();

    // Wait for at least one heartbeat to fire
    await sleep(200);

    const res = await fetch(`http://localhost:${HB_PORT}/api/members`);
    const members = await res.json() as Array<{ name: string; status?: string }>;
    const agent = members.find(m => m.name === 'hb-agent');
    expect(agent).toBeDefined();
    // Status should be set (either idle or whatever the heartbeat sent)
    expect(agent!.status).toBeDefined();

    await client.close();
  });
});
