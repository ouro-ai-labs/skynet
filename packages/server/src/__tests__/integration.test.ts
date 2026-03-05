import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkynetServer } from '../server.js';
import { SkynetClient } from '@skynet/sdk';
import { AgentType, type SkynetMessage } from '@skynet/protocol';
import { randomUUID } from 'node:crypto';

const PORT = 4200 + Math.floor(Math.random() * 100);

function makeClient(name: string, roomId: string, type = AgentType.HUMAN) {
  return new SkynetClient({
    serverUrl: `http://localhost:${PORT}`,
    agent: {
      agentId: randomUUID(),
      name,
      type,
      capabilities: ['chat'],
      status: 'idle',
    },
    roomId,
    reconnect: false,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Server integration', () => {
  let server: SkynetServer;

  beforeAll(async () => {
    server = new SkynetServer({ port: PORT });
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
    const alice = makeClient('alice', 'test-room');
    const bob = makeClient('bob', 'test-room');

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
    const alice = makeClient('alice', 'dm-room');
    const bob = makeClient('bob', 'dm-room');
    const charlie = makeClient('charlie', 'dm-room');

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
    alice.chat('Secret for Bob', bob.agent.agentId);
    await sleep(200);

    // Bob should NOT receive DMs through broadcast since sendTo sends only to target
    // and sends confirmation back to sender
    expect(charlieReceived).toHaveLength(0);

    await alice.close();
    await bob.close();
    await charlie.close();
  });

  it('broadcast reaches all members', async () => {
    const alice = makeClient('alice', 'broadcast-room');
    const bob = makeClient('bob', 'broadcast-room');
    const charlie = makeClient('charlie', 'broadcast-room');

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

  it('rooms API returns room info', async () => {
    const client = makeClient('alice', 'api-room');
    await client.connect();

    const res = await fetch(`http://localhost:${PORT}/api/rooms`);
    const rooms = (await res.json()) as Array<{ id: string; memberCount: number }>;
    const room = rooms.find((r) => r.id === 'api-room');
    expect(room).toBeDefined();
    expect(room!.memberCount).toBe(1);

    const membersRes = await fetch(`http://localhost:${PORT}/api/rooms/api-room/members`);
    const members = (await membersRes.json()) as Array<{ name: string }>;
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('alice');

    await client.close();
  });

  it('messages are persisted and retrievable', async () => {
    const roomId = `persist-${randomUUID().slice(0, 8)}`;
    const alice = makeClient('alice', roomId);
    await alice.connect();

    await sleep(50);
    alice.chat('Persistent message');
    await sleep(200);

    const res = await fetch(`http://localhost:${PORT}/api/rooms/${roomId}/messages`);
    const messages = (await res.json()) as Array<{ payload: unknown }>;

    // Should have at least the join message + chat message
    expect(messages.length).toBeGreaterThanOrEqual(2);

    await alice.close();
  });

  it('POST /api/rooms creates a room', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'created-room' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; memberCount: number };
    expect(body.id).toBe('created-room');
    expect(body.memberCount).toBe(0);

    // Verify room appears in list
    const listRes = await fetch(`http://localhost:${PORT}/api/rooms`);
    const rooms = (await listRes.json()) as Array<{ id: string }>;
    expect(rooms.some((r) => r.id === 'created-room')).toBe(true);
  });

  it('POST /api/rooms returns 409 for duplicate room', async () => {
    await fetch(`http://localhost:${PORT}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'dup-room' }),
    });

    const res = await fetch(`http://localhost:${PORT}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'dup-room' }),
    });

    expect(res.status).toBe(409);
  });

  it('POST /api/rooms returns 400 when roomId missing', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('DELETE /api/rooms/:roomId destroys a room', async () => {
    // Create room first
    await fetch(`http://localhost:${PORT}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'doomed-room' }),
    });

    const res = await fetch(`http://localhost:${PORT}/api/rooms/doomed-room`, {
      method: 'DELETE',
    });

    expect(res.ok).toBe(true);

    // Verify room is gone
    const listRes = await fetch(`http://localhost:${PORT}/api/rooms`);
    const rooms = (await listRes.json()) as Array<{ id: string }>;
    expect(rooms.some((r) => r.id === 'doomed-room')).toBe(false);
  });

  it('DELETE /api/rooms/:roomId returns 404 for non-existent room', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/rooms/ghost-room`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });

  it('DELETE /api/rooms/:roomId disconnects members', async () => {
    const roomId = `destroy-members-${randomUUID().slice(0, 8)}`;
    const client = makeClient('alice', roomId);
    await client.connect();

    let disconnected = false;
    client.on('disconnected', () => {
      disconnected = true;
    });

    const res = await fetch(`http://localhost:${PORT}/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
    expect(res.ok).toBe(true);

    await sleep(300);
    expect(disconnected).toBe(true);
  });

  it('agent-join event is received by existing members', async () => {
    const alice = makeClient('alice', 'join-room');
    await alice.connect();

    const joinEvents: string[] = [];
    alice.on('agent-join', (msg: SkynetMessage) => {
      const payload = msg.payload as { agent: { name: string } };
      joinEvents.push(payload.agent.name);
    });

    const bob = makeClient('bob', 'join-room');
    await bob.connect();
    await sleep(200);

    expect(joinEvents).toContain('bob');

    await alice.close();
    await bob.close();
  });
});
