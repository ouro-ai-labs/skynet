import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkynetWorkspace } from '../server.js';
import { SqliteStore } from '../sqlite-store.js';
import { SkynetClient } from '@skynet-ai/sdk';
import { AgentType, MENTION_ALL, WS_CLOSE_REPLACED, type SkynetMessage } from '@skynet-ai/protocol';
import { randomUUID } from 'node:crypto';

const PORT = 4200 + Math.floor(Math.random() * 100);

/** Register an agent or human via the HTTP API, then return a connected-ready SkynetClient. */
async function makeClient(port: number, name: string, type = AgentType.HUMAN): Promise<SkynetClient> {
  const isHuman = type === AgentType.HUMAN;
  const url = isHuman
    ? `http://localhost:${port}/api/humans`
    : `http://localhost:${port}/api/agents`;
  const body = isHuman
    ? { name }
    : { name, type };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const entity = await res.json() as { id: string };
  return new SkynetClient({
    serverUrl: `http://localhost:${port}`,
    agent: { id: entity.id, name, type, status: 'idle' as const },
    reconnect: false,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Server integration', () => {
  let server: SkynetWorkspace;

  beforeAll(async () => {
    server = new SkynetWorkspace({ port: PORT, store: new SqliteStore(':memory:'), disconnectGraceMs: 100 });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('health endpoint returns ok', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('rejects unregistered agent on WebSocket join', async () => {
    const client = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: randomUUID(), name: 'ghost', type: AgentType.CLAUDE_CODE, status: 'idle' },
      reconnect: false,
    });

    // Server sends an error event then closes the socket.
    // connect() rejects because socket closes before workspace.state is received.
    await expect(client.connect()).rejects.toThrow('Unknown agent ID');
  });

  it('two clients can exchange messages', async () => {
    const alice = await makeClient(PORT, 'alice');
    const bob = await makeClient(PORT, 'bob');

    await alice.connect();
    const bobState = await bob.connect();

    expect(bobState.members).toHaveLength(2);

    const received: string[] = [];
    bob.on('chat', (msg: SkynetMessage) => {
      received.push((msg.payload as { text: string }).text);
    });

    await sleep(50);
    alice.chat('Hello Bob!', [bob.agent.id]);
    await sleep(200);

    expect(received).toContain('Hello Bob!');

    await alice.close();
    await bob.close();
  });

  it('mention reaches only the mentioned agent (non-human agents excluded)', async () => {
    const alice = await makeClient(PORT, 'alice-dm');
    const bob = await makeClient(PORT, 'bob-dm');
    // charlie is a non-human agent — should NOT receive messages not mentioning them
    const charlie = await makeClient(PORT, 'charlie-dm', AgentType.CLAUDE_CODE);

    await alice.connect();
    await bob.connect();
    await charlie.connect();

    const bobReceived: string[] = [];
    const charlieReceived: string[] = [];

    bob.on('chat', (msg: SkynetMessage) => {
      bobReceived.push((msg.payload as { text: string }).text);
    });
    charlie.on('chat', (msg: SkynetMessage) => {
      charlieReceived.push((msg.payload as { text: string }).text);
    });

    await sleep(50);
    alice.chat('Secret for Bob', [bob.agent.id]);
    await sleep(200);

    expect(bobReceived).toContain('Secret for Bob');
    expect(charlieReceived).toHaveLength(0);

    await alice.close();
    await bob.close();
    await charlie.close();
  });

  it('humans see all messages even without being mentioned', async () => {
    const agent1 = await makeClient(PORT, 'agent-vis-1', AgentType.CLAUDE_CODE);
    const agent2 = await makeClient(PORT, 'agent-vis-2', AgentType.CLAUDE_CODE);
    const human = await makeClient(PORT, 'human-vis');

    await agent1.connect();
    await agent2.connect();
    await human.connect();

    const humanReceived: string[] = [];
    human.on('chat', (msg: SkynetMessage) => {
      humanReceived.push((msg.payload as { text: string }).text);
    });

    await sleep(50);
    // agent1 sends to agent2 only — human not mentioned
    agent1.chat('Agent-to-agent secret', [agent2.agent.id]);
    await sleep(200);

    // Human should still see it
    expect(humanReceived).toContain('Agent-to-agent secret');

    await agent1.close();
    await agent2.close();
    await human.close();
  });

  it('@all reaches all members', async () => {
    const alice = await makeClient(PORT, 'alice-bc');
    const bob = await makeClient(PORT, 'bob-bc');
    const charlie = await makeClient(PORT, 'charlie-bc');

    await alice.connect();
    await bob.connect();
    await charlie.connect();

    const bobReceived: string[] = [];
    const charlieReceived: string[] = [];

    bob.on('chat', (msg: SkynetMessage) => {
      bobReceived.push((msg.payload as { text: string }).text);
    });
    charlie.on('chat', (msg: SkynetMessage) => {
      charlieReceived.push((msg.payload as { text: string }).text);
    });

    await sleep(50);
    alice.chat('Hello everyone!', [MENTION_ALL]);
    await sleep(200);

    expect(bobReceived).toContain('Hello everyone!');
    expect(charlieReceived).toContain('Hello everyone!');

    await alice.close();
    await bob.close();
    await charlie.close();
  });

  it('members API returns connected members', async () => {
    const client = await makeClient(PORT, 'alice-api');
    await client.connect();

    const res = await fetch(`http://localhost:${PORT}/api/members`);
    const members = (await res.json()) as Array<{ name: string }>;
    expect(members.some((m) => m.name === 'alice-api')).toBe(true);

    await client.close();
  });

  it('messages are persisted and retrievable', async () => {
    const alice = await makeClient(PORT, 'alice-persist');
    await alice.connect();

    await sleep(50);
    alice.chat('Persistent message');
    await sleep(200);

    const res = await fetch(`http://localhost:${PORT}/api/messages`);
    const messages = (await res.json()) as Array<{ payload: unknown }>;

    // Should have at least join messages + chat messages
    expect(messages.length).toBeGreaterThanOrEqual(2);

    await alice.close();
  });

  it('mentions reach all mentioned agents but not unmentioned non-human agents', async () => {
    const alice = await makeClient(PORT, 'alice-mention');
    const bob = await makeClient(PORT, 'bob-mention');
    const charlie = await makeClient(PORT, 'charlie-mention');
    // dave is a non-human agent — should NOT receive messages not mentioning them
    const dave = await makeClient(PORT, 'dave-mention', AgentType.CLAUDE_CODE);

    await alice.connect();
    await bob.connect();
    await charlie.connect();
    await dave.connect();

    const bobReceived: string[] = [];
    const charlieReceived: string[] = [];
    const daveReceived: string[] = [];

    bob.on('chat', (msg: SkynetMessage) => {
      bobReceived.push((msg.payload as { text: string }).text);
    });
    charlie.on('chat', (msg: SkynetMessage) => {
      charlieReceived.push((msg.payload as { text: string }).text);
    });
    dave.on('chat', (msg: SkynetMessage) => {
      daveReceived.push((msg.payload as { text: string }).text);
    });

    await sleep(50);
    // Alice mentions Bob and Charlie
    alice.chat('Hey discuss this', [bob.agent.id, charlie.agent.id]);
    await sleep(200);

    expect(bobReceived).toContain('Hey discuss this');
    expect(charlieReceived).toContain('Hey discuss this');
    // Dave should NOT receive it
    expect(daveReceived).toHaveLength(0);

    await alice.close();
    await bob.close();
    await charlie.close();
    await dave.close();
  });

  it('agent-join event is received by existing members', async () => {
    const alice = await makeClient(PORT, 'alice-join');
    await alice.connect();

    const joinEvents: string[] = [];
    alice.on('agent-join', (msg: SkynetMessage) => {
      const payload = msg.payload as { agent: { name: string } };
      joinEvents.push(payload.agent.name);
    });

    const bob = await makeClient(PORT, 'bob-join');
    await bob.connect();
    await sleep(200);

    expect(joinEvents).toContain('bob-join');

    await alice.close();
    await bob.close();
  });

  it('agent-leave event is received when a member disconnects', async () => {
    const alice = await makeClient(PORT, 'alice-leave');
    const bob = await makeClient(PORT, 'bob-leave');

    await alice.connect();
    await bob.connect();
    await sleep(50);

    const leaveEvents: string[] = [];
    alice.on('agent-leave', (msg: SkynetMessage) => {
      const payload = msg.payload as { agentId: string };
      leaveEvents.push(payload.agentId);
    });

    await bob.close();
    // Wait for disconnect grace period (100ms) + propagation
    await sleep(500);

    expect(leaveEvents).toHaveLength(1);
    expect(leaveEvents[0]).toBe(bob.agent.id);

    await alice.close();
  });

  it('reconnecting agent does not broadcast duplicate join/leave', async () => {
    const alice = await makeClient(PORT, 'alice-recon');
    // Register bob via HTTP API so we can reuse the ID for reconnection
    const bobRes = await fetch(`http://localhost:${PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bob-recon' }),
    });
    const bobEntity = await bobRes.json() as { id: string };

    const reconnectBob = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: bobEntity.id, name: 'bob-recon', type: AgentType.HUMAN, status: 'idle' },
      reconnect: false,
    });

    await alice.connect();
    await reconnectBob.connect();
    await sleep(50);

    const joinEvents: string[] = [];
    const leaveEvents: string[] = [];
    alice.on('agent-join', (msg: SkynetMessage) => {
      const payload = msg.payload as { agent: { name: string } };
      joinEvents.push(payload.agent.name);
    });
    alice.on('agent-leave', (msg: SkynetMessage) => {
      const payload = msg.payload as { agentId: string };
      leaveEvents.push(payload.agentId);
    });

    // Simulate reconnection: create a new client with the SAME agent ID
    const bobAgentId = reconnectBob.agent.id;
    // Force close without explicit LEAVE (simulates network drop)
    (reconnectBob as unknown as { ws: { terminate: () => void } }).ws.terminate();

    // Immediately reconnect with the same agent ID (within grace period)
    const reconnectBob2 = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: bobAgentId, name: 'bob-recon', type: AgentType.HUMAN, status: 'idle' },
      reconnect: false,
    });
    await reconnectBob2.connect();
    await sleep(300);

    // No join or leave events should have been broadcast (silent reconnection)
    expect(joinEvents).toHaveLength(0);
    expect(leaveEvents).toHaveLength(0);

    await alice.close();
    await reconnectBob2.close();
  });

  it('rapid reconnection does not cause reconnect loop', async () => {
    const alice = await makeClient(PORT, 'alice-rapid');

    const bobRes = await fetch(`http://localhost:${PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bob-rapid' }),
    });
    const bobEntity = await bobRes.json() as { id: string };

    await alice.connect();

    const leaveEvents: string[] = [];
    alice.on('agent-leave', (msg: SkynetMessage) => {
      const payload = msg.payload as { agentId: string };
      leaveEvents.push(payload.agentId);
    });

    // Rapidly reconnect bob 5 times to simulate the race condition
    let lastBob: SkynetClient | null = null;
    for (let i = 0; i < 5; i++) {
      const bob = new SkynetClient({
        serverUrl: `http://localhost:${PORT}`,
        agent: { id: bobEntity.id, name: 'bob-rapid', type: AgentType.HUMAN, status: 'idle' },
        reconnect: false,
      });
      await bob.connect();
      if (lastBob) {
        // Old client's socket was replaced server-side; just terminate it
        (lastBob as unknown as { ws: { terminate: () => void } }).ws.terminate();
      }
      lastBob = bob;
    }

    // Wait for any grace period timers to fire
    await sleep(500);

    // No leave events should have been broadcast — bob never truly left
    expect(leaveEvents).toHaveLength(0);

    await alice.close();
    if (lastBob) await lastBob.close();
  });

  it('sends WS_CLOSE_REPLACED (4001) when a duplicate connection replaces an existing one', async () => {
    // Register bob via HTTP API
    const bobRes = await fetch(`http://localhost:${PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bob-replaced' }),
    });
    const bobEntity = await bobRes.json() as { id: string };

    // First connection
    const bob1 = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: bobEntity.id, name: 'bob-replaced', type: AgentType.HUMAN, status: 'idle' },
      reconnect: false,
    });
    await bob1.connect();

    // Capture close code on the first connection's underlying WebSocket
    const closeCode = new Promise<number>((resolve) => {
      const ws = (bob1 as unknown as { ws: { on: (event: string, cb: (code: number) => void) => void } }).ws;
      ws.on('close', (code: number) => resolve(code));
    });

    // Second connection with the same agent ID — should replace the first
    const bob2 = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: bobEntity.id, name: 'bob-replaced', type: AgentType.HUMAN, status: 'idle' },
      reconnect: false,
    });
    await bob2.connect();

    // First connection should have received close code 4001
    const code = await closeCode;
    expect(code).toBe(WS_CLOSE_REPLACED);

    await bob2.close();
  });

  it('workspace.state respects lastSeenTimestamp from client', async () => {
    const alice = await makeClient(PORT, 'alice-seen');
    await alice.connect();
    await sleep(50);

    // Register bob via HTTP API
    const bobRes = await fetch(`http://localhost:${PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bob-seen' }),
    });
    const bobEntity = await bobRes.json() as { id: string };
    const bobId = bobEntity.id;

    // Send two mentions to bob at different times
    alice.chat('old msg for bob', [bobId]);
    await sleep(100);

    // Record the timestamp boundary
    const boundary = Date.now();
    await sleep(50);

    alice.chat('new msg for bob', [bobId]);
    await sleep(200);

    // Bob connects with lastSeenTimestamp — should only get the newer message
    const bob = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: bobId, name: 'bob-seen', type: AgentType.HUMAN, status: 'idle' },
      reconnect: false,
      lastSeenTimestamp: boundary,
    });
    const state = await bob.connect();

    const chatMessages = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('new msg for bob');
    expect(texts).not.toContain('old msg for bob');

    await alice.close();
    await bob.close();
  });

  it('status change is broadcast to other members via heartbeat', async () => {
    const alice = await makeClient(PORT, 'alice-status');
    const bob = await makeClient(PORT, 'bob-status');

    await alice.connect();
    await bob.connect();
    await sleep(50);

    const statusEvents: Array<{ agentId: string; status: string }> = [];
    bob.on('status-change', (data: { agentId: string; status: string }) => {
      statusEvents.push(data);
    });

    // Simulate heartbeat with status change (idle → busy)
    alice.agent.status = 'busy';
    (alice as unknown as { send(e: { action: string; data: unknown }): void }).send({
      action: 'heartbeat',
      data: { agentId: alice.agent.id, status: 'busy' },
    });
    await sleep(100);

    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].agentId).toBe(alice.agent.id);
    expect(statusEvents[0].status).toBe('busy');

    // Same status heartbeat — should NOT broadcast again
    (alice as unknown as { send(e: { action: string; data: unknown }): void }).send({
      action: 'heartbeat',
      data: { agentId: alice.agent.id, status: 'busy' },
    });
    await sleep(100);

    expect(statusEvents).toHaveLength(1);

    // Status change back to idle
    (alice as unknown as { send(e: { action: string; data: unknown }): void }).send({
      action: 'heartbeat',
      data: { agentId: alice.agent.id, status: 'idle' },
    });
    await sleep(100);

    expect(statusEvents).toHaveLength(2);
    expect(statusEvents[1].status).toBe('idle');

    await alice.close();
    await bob.close();
  });

  it('status change is not echoed back to sender', async () => {
    const alice = await makeClient(PORT, 'alice-status-echo');
    await alice.connect();
    await sleep(50);

    const statusEvents: Array<{ agentId: string; status: string }> = [];
    alice.on('status-change', (data: { agentId: string; status: string }) => {
      statusEvents.push(data);
    });

    (alice as unknown as { send(e: { action: string; data: unknown }): void }).send({
      action: 'heartbeat',
      data: { agentId: alice.agent.id, status: 'busy' },
    });
    await sleep(100);

    expect(statusEvents).toHaveLength(0);

    await alice.close();
  });

  it('server enriches mentions from markdown-wrapped @names in message text', async () => {
    const sender = await makeClient(PORT, 'enrich-sender');
    const target = await makeClient(PORT, 'enrich-target', AgentType.CLAUDE_CODE);
    await sender.connect();
    await target.connect();
    await sleep(50);

    const received: SkynetMessage[] = [];
    target.on('chat', (msg: SkynetMessage) => received.push(msg));

    // Send message with markdown-wrapped mention — client passes empty mentions
    sender.chat('**@enrich-target** please do this', []);
    await sleep(200);

    // The server should have enriched mentions so target receives the message
    expect(received).toHaveLength(1);
    expect(received[0].mentions).toContain(target.agent.id);

    await sender.close();
    await target.close();
  });

  it('server enriches mentions for offline agents visible on reconnect', async () => {
    const sender = await makeClient(PORT, 'offline-sender');
    // Register offline-agent but don't connect it yet
    const offlineAgent = await makeClient(PORT, 'offline-agent', AgentType.CLAUDE_CODE);
    await sender.connect();
    await sleep(50);

    // Send message mentioning the offline agent (client can't resolve, sends empty mentions)
    sender.chat('Hey **@offline-agent** check this', []);
    await sleep(200);

    // Now the offline agent connects — should see the message in history
    const state = await offlineAgent.connect();
    const chatMessages = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('Hey **@offline-agent** check this');

    await sender.close();
    await offlineAgent.close();
  });

  it('server does not duplicate already-resolved mentions', async () => {
    const sender = await makeClient(PORT, 'nodup-sender');
    const target = await makeClient(PORT, 'nodup-target', AgentType.CLAUDE_CODE);
    await sender.connect();
    await target.connect();
    await sleep(50);

    const received: SkynetMessage[] = [];
    target.on('chat', (msg: SkynetMessage) => received.push(msg));

    // Client already resolved the mention correctly
    sender.chat('@nodup-target please review', [target.agent.id]);
    await sleep(200);

    expect(received).toHaveLength(1);
    // Should have exactly one occurrence of target ID, not duplicated
    const targetMentions = received[0].mentions!.filter(id => id === target.agent.id);
    expect(targetMentions).toHaveLength(1);

    await sender.close();
    await target.close();
  });

  it('workspace.state for non-human agents only includes messages mentioning them', async () => {
    const alice = await makeClient(PORT, 'alice-state');
    // bob is a non-human agent — should only see mentioned messages
    const bob = await makeClient(PORT, 'bob-state', AgentType.CLAUDE_CODE);
    await alice.connect();
    await sleep(50);

    // Message without mention (not addressed to bob)
    alice.chat('General broadcast');
    await sleep(50);
    // Mention bob
    alice.chat('DM for bob', [bob.agent.id]);
    await sleep(50);
    // Another mention of bob
    alice.chat('Hey @bob check this', [bob.agent.id]);
    await sleep(200);

    // Bob connects and should only see messages mentioning him
    const state = await bob.connect();

    const chatMessages = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('DM for bob');
    expect(texts).toContain('Hey @bob check this');
    expect(texts).not.toContain('General broadcast');

    await alice.close();
    await bob.close();
  });

  it('workspace.state for humans includes all recent messages', async () => {
    const agent = await makeClient(PORT, 'agent-state', AgentType.CLAUDE_CODE);
    const human = await makeClient(PORT, 'human-state');
    await agent.connect();
    await sleep(50);

    // Message without any mention of human
    agent.chat('Agent internal note');
    await sleep(200);

    // Human connects and should see all messages
    const state = await human.connect();

    const chatMessages = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('Agent internal note');

    await agent.close();
    await human.close();
  });
});

describe('Server HTTP API', () => {
  let server: SkynetWorkspace;
  const API_PORT = 4200 + Math.floor(Math.random() * 100) + 100;

  beforeAll(async () => {
    server = new SkynetWorkspace({ port: API_PORT, store: new SqliteStore(':memory:') });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('creates and retrieves an agent', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-agent', type: 'claude-code', role: 'dev' }),
    });
    expect(createRes.status).toBe(201);
    const agent = await createRes.json() as { id: string; name: string; type: string; role: string };
    expect(agent.name).toBe('test-agent');
    expect(agent.type).toBe('claude-code');
    expect(agent.role).toBe('dev');

    // Get by ID
    const getRes = await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json() as { name: string };
    expect(fetched.name).toBe('test-agent');

    // Get by name
    const getByNameRes = await fetch(`http://localhost:${API_PORT}/api/agents/test-agent`);
    expect(getByNameRes.status).toBe(200);

    // List
    const listRes = await fetch(`http://localhost:${API_PORT}/api/agents`);
    const agents = await listRes.json() as Array<{ name: string }>;
    expect(agents.some(a => a.name === 'test-agent')).toBe(true);
  });

  it('returns 409 for duplicate agent name', async () => {
    await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup-agent', type: 'generic' }),
    });
    const res = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup-agent', type: 'generic' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for agent missing name', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'generic' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent agent', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/agents/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('creates and retrieves a human', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-human' }),
    });
    expect(createRes.status).toBe(201);
    const human = await createRes.json() as { id: string; name: string };
    expect(human.name).toBe('test-human');

    // Get by ID
    const getRes = await fetch(`http://localhost:${API_PORT}/api/humans/${human.id}`);
    expect(getRes.status).toBe(200);

    // List
    const listRes = await fetch(`http://localhost:${API_PORT}/api/humans`);
    const humans = await listRes.json() as Array<{ name: string }>;
    expect(humans.some(h => h.name === 'test-human')).toBe(true);
  });

  it('returns 409 for duplicate human name', async () => {
    await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup-human' }),
    });
    const res = await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup-human' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for non-existent human', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/humans/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('cross-entity name uniqueness: agent name blocks human creation', async () => {
    await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'shared-name', type: 'generic' }),
    });
    const res = await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'shared-name' }),
    });
    expect(res.status).toBe(409);
  });

  it('name check endpoint', async () => {
    const availRes = await fetch(`http://localhost:${API_PORT}/api/names/check?name=fresh-unique-name`);
    const avail = await availRes.json() as { available: boolean };
    expect(avail.available).toBe(true);

    await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'taken-name-check', type: 'generic' }),
    });
    const takenRes = await fetch(`http://localhost:${API_PORT}/api/names/check?name=taken-name-check`);
    const taken = await takenRes.json() as { available: boolean };
    expect(taken.available).toBe(false);
  });

  it('name check returns 400 without name param', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/names/check`);
    expect(res.status).toBe(400);
  });

  it('deletes an agent', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delete-me-agent', type: 'generic' }),
    });
    expect(createRes.status).toBe(201);
    const agent = await createRes.json() as { id: string; name: string };

    const deleteRes = await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json() as { deleted: { name: string } };
    expect(body.deleted.name).toBe('delete-me-agent');

    // Verify it's gone
    const getRes = await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting non-existent agent', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/agents/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting agent by name instead of UUID', async () => {
    await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'name-delete-test', type: 'generic' }),
    });
    const res = await fetch(`http://localhost:${API_PORT}/api/agents/name-delete-test`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('deletes a human', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delete-me-human' }),
    });
    expect(createRes.status).toBe(201);
    const human = await createRes.json() as { id: string; name: string };

    const deleteRes = await fetch(`http://localhost:${API_PORT}/api/humans/${human.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json() as { deleted: { name: string } };
    expect(body.deleted.name).toBe('delete-me-human');

    // Verify it's gone
    const getRes = await fetch(`http://localhost:${API_PORT}/api/humans/${human.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting non-existent human', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/humans/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting human by name instead of UUID', async () => {
    await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'name-delete-human-test' }),
    });
    const res = await fetch(`http://localhost:${API_PORT}/api/humans/name-delete-human-test`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('name becomes available after agent deletion', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'recycle-name', type: 'generic' }),
    });
    const agent = await createRes.json() as { id: string };

    await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}`, { method: 'DELETE' });

    const checkRes = await fetch(`http://localhost:${API_PORT}/api/names/check?name=recycle-name`);
    const check = await checkRes.json() as { available: boolean };
    expect(check.available).toBe(true);
  });

  it('messages endpoint supports pagination', async () => {
    // Register and connect a client via HTTP API
    const res = await fetch(`http://localhost:${API_PORT}/api/humans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'paginator' }),
    });
    const entity = await res.json() as { id: string };

    const paginatorClient = new SkynetClient({
      serverUrl: `http://localhost:${API_PORT}`,
      agent: { id: entity.id, name: 'paginator', type: AgentType.HUMAN, status: 'idle' },
      reconnect: false,
    });
    await paginatorClient.connect();
    await sleep(50);
    paginatorClient.chat('page msg 1');
    paginatorClient.chat('page msg 2');
    paginatorClient.chat('page msg 3');
    await sleep(200);

    // Get with limit
    const limitRes = await fetch(`http://localhost:${API_PORT}/api/messages?limit=2`);
    const limitMsgs = await limitRes.json() as SkynetMessage[];
    expect(limitMsgs.length).toBeLessThanOrEqual(2);

    await paginatorClient.close();
  });

  it('interrupt endpoint sends control message to connected agent', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'interrupt-agent', type: 'claude-code' }),
    });
    const agent = await createRes.json() as { id: string };

    const client = new SkynetClient({
      serverUrl: `http://localhost:${API_PORT}`,
      agent: { id: agent.id, name: 'interrupt-agent', type: AgentType.CLAUDE_CODE, status: 'idle' },
      reconnect: false,
    });
    await client.connect();

    const received: SkynetMessage[] = [];
    client.on('agent-interrupt', (msg: SkynetMessage) => received.push(msg));

    await sleep(50);
    const res = await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.ok).toBe(true);

    await sleep(100);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('agent.interrupt');

    await client.close();
  });

  it('forget endpoint sends control message to connected agent', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'forget-agent', type: 'claude-code' }),
    });
    const agent = await createRes.json() as { id: string };

    const client = new SkynetClient({
      serverUrl: `http://localhost:${API_PORT}`,
      agent: { id: agent.id, name: 'forget-agent', type: AgentType.CLAUDE_CODE, status: 'idle' },
      reconnect: false,
    });
    await client.connect();

    const received: SkynetMessage[] = [];
    client.on('agent-forget', (msg: SkynetMessage) => received.push(msg));

    await sleep(50);
    const res = await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}/forget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.ok).toBe(true);

    await sleep(100);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('agent.forget');

    await client.close();
  });

  it('interrupt returns 409 for disconnected agent', async () => {
    const createRes = await fetch(`http://localhost:${API_PORT}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'offline-interrupt', type: 'claude-code' }),
    });
    const agent = await createRes.json() as { id: string };

    const res = await fetch(`http://localhost:${API_PORT}/api/agents/${agent.id}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });

  it('forget returns 404 for non-existent agent', async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/agents/nonexistent/forget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
