import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkynetWorkspace } from '../server.js';
import { SqliteStore } from '../sqlite-store.js';
import { SkynetClient } from '@skynet/sdk';
import { AgentType, type SkynetMessage } from '@skynet/protocol';
import { randomUUID } from 'node:crypto';

const PORT = 4200 + Math.floor(Math.random() * 100);

function makeClient(name: string, type = AgentType.HUMAN) {
  return new SkynetClient({
    serverUrl: `http://localhost:${PORT}`,
    agent: {
      id: randomUUID(),
      name,
      type,
    },
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

  it('two clients can exchange messages', async () => {
    const alice = makeClient('alice');
    const bob = makeClient('bob');

    await alice.connect();
    const bobState = await bob.connect();

    expect(bobState.members).toHaveLength(2);

    const received: string[] = [];
    bob.on('chat', (msg: SkynetMessage) => {
      received.push((msg.payload as { text: string }).text);
    });

    await sleep(50);
    alice.chat('Hello Bob!');
    await sleep(200);

    expect(received).toContain('Hello Bob!');

    await alice.close();
    await bob.close();
  });

  it('DM reaches only the target', async () => {
    const alice = makeClient('alice-dm');
    const bob = makeClient('bob-dm');
    const charlie = makeClient('charlie-dm');

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
    alice.chat('Secret for Bob', bob.agent.id);
    await sleep(200);

    expect(charlieReceived).toHaveLength(0);

    await alice.close();
    await bob.close();
    await charlie.close();
  });

  it('broadcast reaches all members', async () => {
    const alice = makeClient('alice-bc');
    const bob = makeClient('bob-bc');
    const charlie = makeClient('charlie-bc');

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
    alice.chat('Hello everyone!');
    await sleep(200);

    expect(bobReceived).toContain('Hello everyone!');
    expect(charlieReceived).toContain('Hello everyone!');

    await alice.close();
    await bob.close();
    await charlie.close();
  });

  it('members API returns connected members', async () => {
    const client = makeClient('alice-api');
    await client.connect();

    const res = await fetch(`http://localhost:${PORT}/api/members`);
    const members = (await res.json()) as Array<{ name: string }>;
    expect(members.some((m) => m.name === 'alice-api')).toBe(true);

    await client.close();
  });

  it('messages are persisted and retrievable', async () => {
    const alice = makeClient('alice-persist');
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

  it('DM with mentions reaches both target and mentioned agents', async () => {
    const alice = makeClient('alice-mention');
    const bob = makeClient('bob-mention');
    const charlie = makeClient('charlie-mention');
    const dave = makeClient('dave-mention');

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
    // Alice sends a DM to Bob, with Charlie mentioned
    alice.chat('Hey discuss this', bob.agent.id, [charlie.agent.id]);
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
    const alice = makeClient('alice-join');
    await alice.connect();

    const joinEvents: string[] = [];
    alice.on('agent-join', (msg: SkynetMessage) => {
      const payload = msg.payload as { agent: { name: string } };
      joinEvents.push(payload.agent.name);
    });

    const bob = makeClient('bob-join');
    await bob.connect();
    await sleep(200);

    expect(joinEvents).toContain('bob-join');

    await alice.close();
    await bob.close();
  });

  it('agent-leave event is received when a member disconnects', async () => {
    const alice = makeClient('alice-leave');
    const bob = makeClient('bob-leave');

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
    const alice = makeClient('alice-recon');
    const reconnectBob = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: {
        id: randomUUID(),
        name: 'bob-recon',
        type: AgentType.HUMAN,
      },
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
      agent: {
        id: bobAgentId,
        name: 'bob-recon',
        type: AgentType.HUMAN,
      },
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

  it('workspace.state respects lastSeenTimestamp from client', async () => {
    const alice = makeClient('alice-seen');
    await alice.connect();
    await sleep(50);

    const bobId = randomUUID();

    // Send two DMs to bob at different times
    alice.chat('old msg for bob', bobId);
    await sleep(100);

    // Record the timestamp boundary
    const boundary = Date.now();
    await sleep(50);

    alice.chat('new msg for bob', bobId);
    await sleep(200);

    // Bob connects with lastSeenTimestamp — should only get the newer message
    const bob = new SkynetClient({
      serverUrl: `http://localhost:${PORT}`,
      agent: { id: bobId, name: 'bob-seen', type: AgentType.HUMAN },
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

  it('workspace.state only includes messages mentioning the connecting agent', async () => {
    const alice = makeClient('alice-state');
    const bob = makeClient('bob-state');
    await alice.connect();
    await sleep(50);

    // Broadcast message (not addressed to bob)
    alice.chat('General broadcast');
    await sleep(50);
    // DM to bob
    alice.chat('DM for bob', bob.agent.id);
    await sleep(50);
    // Message mentioning bob
    alice.chat('Hey @bob check this', null, [bob.agent.id]);
    await sleep(200);

    // Bob connects and should only see messages addressed to or mentioning him
    const state = await bob.connect();

    const chatMessages = state.recentMessages.filter(m => m.type === 'chat');
    const texts = chatMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('DM for bob');
    expect(texts).toContain('Hey @bob check this');
    expect(texts).not.toContain('General broadcast');

    await alice.close();
    await bob.close();
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

  it('messages endpoint supports pagination', async () => {
    // Connect a client and send a few messages
    const client = makeClient('paginator');
    // Use the API port server
    const paginatorClient = new SkynetClient({
      serverUrl: `http://localhost:${API_PORT}`,
      agent: { id: randomUUID(), name: 'paginator', type: AgentType.HUMAN },
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
});
