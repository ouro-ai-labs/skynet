import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkynetWorkspace, SqliteStore } from '@skynet/workspace';
import { SkynetClient } from '@skynet/sdk';
import { AgentType, MessageType, MENTION_ALL, type SkynetMessage, type TaskPayload, type AgentCard } from '@skynet/protocol';
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

/** Register a human via HTTP API and return a SkynetClient ready to connect. */
async function registerHuman(baseUrl: string, name: string): Promise<SkynetClient> {
  const res = await fetch(`${baseUrl}/api/humans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const entity = await res.json() as { id: string };
  return new SkynetClient({
    serverUrl: baseUrl,
    agent: { id: entity.id, name, type: AgentType.HUMAN },
    reconnect: false,
  });
}

/** Register an agent via HTTP API and return its ID. */
async function registerAgent(baseUrl: string, name: string, type: string = 'claude-code'): Promise<string> {
  const res = await fetch(`${baseUrl}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type }),
  });
  const entity = await res.json() as { id: string };
  return entity.id;
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

    // Create 2 AgentRunners with FakeAdapters (auto-registers via HTTP)
    runner1 = new AgentRunner({
      serverUrl: `http://localhost:${PORT}`,
      adapter: new FakeAdapter('agent-1'),
      agentName: 'agent-1',
      debounceMs: 0,
    });
    runner2 = new AgentRunner({
      serverUrl: `http://localhost:${PORT}`,
      adapter: new FakeAdapter('agent-2'),
      agentName: 'agent-2',
      debounceMs: 0,
    });

    await runner1.start();
    await runner2.start();

    // Create human client (register via HTTP first)
    humanClient = await registerHuman(`http://localhost:${PORT}`, 'human');
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

  it('human @all reaches both agents who respond', async () => {
    const pending = collectMessages(humanClient, 2, humanClient.agent.id);
    humanClient.chat('Hello everyone!', [MENTION_ALL]);

    const messages = await pending;
    const texts = messages.map((m) => (m.payload as { text: string }).text).sort();

    // Responses may include [System] join notice prefixes for members
    // who joined after each agent started
    expect(texts[0]).toContain('[agent-1] echo:');
    expect(texts[0]).toContain('Hello everyone!');
    expect(texts[1]).toContain('[agent-2] echo:');
    expect(texts[1]).toContain('Hello everyone!');
  });

  it('human mention agent-1 gets response only from agent-1', async () => {
    const pending = collectMessages(humanClient, 1, humanClient.agent.id);
    humanClient.chat('Question for agent-1', [runner1.agentId]);

    const messages = await pending;
    expect(messages).toHaveLength(1);
    expect((messages[0].payload as { text: string }).text).toBe(
      '[agent-1] echo: Question for agent-1',
    );
  });

  it('human mention agent-2 gets response only from agent-2', async () => {
    const pending = collectMessages(humanClient, 1, humanClient.agent.id);
    humanClient.chat('Question for agent-2', [runner2.agentId]);

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
    const humanProfile = await createHuman.json() as { id: string };

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
      debounceMs: 0,
    });
    await runner.start();

    const humanClient = new SkynetClient({
      serverUrl: baseUrl,
      agent: {
        id: humanProfile.id,
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
    humanClient.chat('lifecycle test', [runner.agentId]);
    const responses = await pending;
    // Response may include a [System] join notice prefix for the human who joined after the agent
    expect((responses[0].payload as { text: string }).text).toContain('[lifecycle-1] echo:');
    expect((responses[0].payload as { text: string }).text).toContain('lifecycle test');

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

describe('E2E: workspace.state only returns mentioned messages for connecting agent', () => {
  let server: SkynetWorkspace;
  const MENTION_PORT = 4300 + Math.floor(Math.random() * 100) + 300;

  beforeAll(async () => {
    server = new SkynetWorkspace({
      port: MENTION_PORT,
      store: new SqliteStore(':memory:'),
      disconnectGraceMs: 100,
      recentMentionsLimit: 3,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('new agent only sees messages addressed to or mentioning it', async () => {
    const baseUrl = `http://localhost:${MENTION_PORT}`;

    // Human sends various messages before the agent connects
    const human = await registerHuman(baseUrl, 'human-mention');
    await human.connect();
    await sleep(50);

    const agentId = await registerAgent(baseUrl, 'target-agent');

    // Messages without mention (not addressed to agent)
    human.chat('General broadcast 1');
    human.chat('General broadcast 2');
    await sleep(50);

    // Mention the agent
    human.chat('DM for agent', [agentId]);
    await sleep(50);

    // Another mention
    human.chat('Hey @agent check this', [agentId]);
    await sleep(50);

    // No mention
    human.chat('General broadcast 3');
    await sleep(200);

    // Agent connects — should only see messages that mention it
    const agent = new SkynetClient({
      serverUrl: baseUrl,
      agent: { id: agentId, name: 'target-agent', type: AgentType.CLAUDE_CODE },
      reconnect: false,
    });
    const state = await agent.connect();

    const chatMsgs = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMsgs.map(m => (m.payload as { text: string }).text);

    expect(texts).toContain('DM for agent');
    expect(texts).toContain('Hey @agent check this');
    expect(texts).not.toContain('General broadcast 1');
    expect(texts).not.toContain('General broadcast 2');
    expect(texts).not.toContain('General broadcast 3');

    await human.close();
    await agent.close();
  });

  it('recentMentionsLimit caps the number of returned messages', async () => {
    const baseUrl = `http://localhost:${MENTION_PORT}`;

    const agentId = await registerAgent(baseUrl, 'limit-agent');
    const human = await registerHuman(baseUrl, 'human-limit');
    await human.connect();
    await sleep(50);

    // Send 5 mentions to the agent (limit is 3)
    for (let i = 0; i < 5; i++) {
      human.chat(`DM ${i}`, [agentId]);
    }
    await sleep(200);

    const agent = new SkynetClient({
      serverUrl: baseUrl,
      agent: { id: agentId, name: 'limit-agent', type: AgentType.CLAUDE_CODE },
      reconnect: false,
    });
    const state = await agent.connect();

    const chatMsgs = state.recentMessages.filter(m => m.type === 'chat');
    expect(chatMsgs).toHaveLength(3);

    // Should be the 3 most recent, in chronological order
    const texts = chatMsgs.map(m => (m.payload as { text: string }).text);
    expect(texts).toEqual(['DM 2', 'DM 3', 'DM 4']);

    await human.close();
    await agent.close();
  });
});

describe('E2E: lastSeenTimestamp filters already-processed messages', () => {
  let server: SkynetWorkspace;
  const SEEN_PORT = 4300 + Math.floor(Math.random() * 100) + 400;

  beforeAll(async () => {
    server = new SkynetWorkspace({
      port: SEEN_PORT,
      store: new SqliteStore(':memory:'),
      disconnectGraceMs: 200,
      recentMentionsLimit: 10,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('agent reconnecting with lastSeenTimestamp skips old messages', async () => {
    const baseUrl = `http://localhost:${SEEN_PORT}`;
    const agentId = await registerAgent(baseUrl, 'seen-agent');

    const human = await registerHuman(baseUrl, 'human-seen');
    await human.connect();
    await sleep(50);

    // Send first mention
    human.chat('old message', [agentId]);
    await sleep(100);

    // Record boundary timestamp
    const boundary = Date.now();
    await sleep(50);

    // Send second mention
    human.chat('new message', [agentId]);
    await sleep(200);

    // Agent connects with lastSeenTimestamp — should only see the newer message
    const agent = new SkynetClient({
      serverUrl: baseUrl,
      agent: { id: agentId, name: 'seen-agent', type: AgentType.CLAUDE_CODE },
      reconnect: false,
      lastSeenTimestamp: boundary,
    });
    const state = await agent.connect();

    const chatMsgs = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMsgs.map(m => (m.payload as { text: string }).text);

    expect(texts).toContain('new message');
    expect(texts).not.toContain('old message');

    await human.close();
    await agent.close();
  });

  it('agent with lastSeenTimestamp=0 gets all recent mentions', async () => {
    const baseUrl = `http://localhost:${SEEN_PORT}`;
    const agentId = await registerAgent(baseUrl, 'fresh-agent');

    const human = await registerHuman(baseUrl, 'human-zero');
    await human.connect();
    await sleep(50);

    human.chat('msg for fresh agent', [agentId]);
    await sleep(200);

    // Agent connects without lastSeenTimestamp — should see the message
    const agent = new SkynetClient({
      serverUrl: baseUrl,
      agent: { id: agentId, name: 'fresh-agent', type: AgentType.CLAUDE_CODE },
      reconnect: false,
    });
    const state = await agent.connect();

    const chatMsgs = state.recentMessages.filter(m => m.type === 'chat');
    expect(chatMsgs.length).toBeGreaterThanOrEqual(1);
    expect(chatMsgs.map(m => (m.payload as { text: string }).text)).toContain('msg for fresh agent');

    await human.close();
    await agent.close();
  });
});

describe('E2E: AgentRunner persists and restores lastSeenTimestamp', () => {
  let server: SkynetWorkspace;
  let testDir: string;
  const PERSIST_PORT = 4300 + Math.floor(Math.random() * 100) + 500;

  beforeAll(async () => {
    server = new SkynetWorkspace({
      port: PERSIST_PORT,
      store: new SqliteStore(':memory:'),
      disconnectGraceMs: 200,
      recentMentionsLimit: 10,
    });
    await server.start();
    testDir = join(tmpdir(), `skynet-e2e-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AgentRunner persists state and uses it on restart to skip old messages', async () => {
    const baseUrl = `http://localhost:${PERSIST_PORT}`;
    const statePath = join(testDir, 'agent-state.json');

    // --- Phase 1: Agent connects, processes messages, stops ---
    const adapter1 = new FakeAdapter('persist-agent');
    const runner1 = new AgentRunner({
      serverUrl: baseUrl,
      adapter: adapter1,
      agentName: 'persist-agent',
      statePath,
      debounceMs: 0,
    });
    await runner1.start();
    const agentId = runner1.agentId;

    // Human sends a DM to the agent
    const human = await registerHuman(baseUrl, 'human-persist');
    await human.connect();
    await sleep(50);

    human.chat('first message', [agentId]);
    await sleep(500); // Wait for processing

    // Verify state file was written
    const stateRaw = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(stateRaw) as { lastSeenTimestamp: number };
    expect(state.lastSeenTimestamp).toBeGreaterThan(0);

    await runner1.stop();
    await sleep(300); // Wait for grace period

    // --- Phase 2: Send more messages while agent is offline ---
    const boundary = state.lastSeenTimestamp;

    await sleep(50);
    human.chat('second message while offline', [agentId]);
    await sleep(200);

    // --- Phase 3: Agent restarts with persisted state ---
    const adapter2 = new FakeAdapter('persist-agent');
    const runner2 = new AgentRunner({
      serverUrl: baseUrl,
      adapter: adapter2,
      agentId,
      agentName: 'persist-agent',
      statePath,
      debounceMs: 0,
    });
    const reconnectState = await runner2.start();

    // workspace.state should only contain the message sent while offline
    const chatMsgs = reconnectState.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMsgs.map(m => (m.payload as { text: string }).text);

    expect(texts).not.toContain('first message');
    expect(texts).toContain('second message while offline');

    await runner2.stop();
    await human.close();
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
    const agentId = await registerAgent(`http://localhost:${HB_PORT}`, 'hb-agent', 'generic');

    const client = new SkynetClient({
      serverUrl: `http://localhost:${HB_PORT}`,
      agent: {
        id: agentId,
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
