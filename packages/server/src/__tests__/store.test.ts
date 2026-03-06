import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../sqlite-store.js';
import { createChatMessage, createMessage, MessageType, AgentType } from '@skynet/protocol';
import type { Store } from '../store.js';

describe('SqliteStore', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('saves and retrieves a message by id', () => {
    const msg = createChatMessage('alice', 'room-1', 'hello');
    store.save(msg);

    const retrieved = store.getById(msg.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(msg.id);
    expect(retrieved!.from).toBe('alice');
    expect(retrieved!.payload).toEqual({ text: 'hello' });
  });

  it('returns undefined for non-existent message', () => {
    expect(store.getById('non-existent')).toBeUndefined();
  });

  it('retrieves messages by room', () => {
    store.save(createChatMessage('alice', 'room-1', 'msg 1'));
    store.save(createChatMessage('bob', 'room-1', 'msg 2'));
    store.save(createChatMessage('charlie', 'room-2', 'msg in other room'));

    const messages = store.getByRoom('room-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].from).toBe('alice');
    expect(messages[1].from).toBe('bob');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      store.save(createChatMessage('alice', 'room-1', `msg ${i}`));
    }

    const messages = store.getByRoom('room-1', 3);
    expect(messages).toHaveLength(3);
  });

  it('supports before parameter for pagination', () => {
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      const msg = createMessage({
        type: MessageType.CHAT,
        from: 'alice',
        to: null,
        roomId: 'room-1',
        timestamp: 1000 + i,
        payload: { text: `msg ${i}` },
      });
      store.save(msg);
      msgs.push(msg);
    }

    const before = store.getByRoom('room-1', 10, 1003);
    expect(before).toHaveLength(3);
    expect((before[0].payload as { text: string }).text).toBe('msg 0');
  });

  it('handles messages with replyTo', () => {
    const original = createChatMessage('alice', 'room-1', 'original');
    store.save(original);

    const reply = createMessage({
      type: MessageType.CHAT,
      from: 'bob',
      to: null,
      roomId: 'room-1',
      payload: { text: 'reply' },
      replyTo: original.id,
    });
    store.save(reply);

    const retrieved = store.getById(reply.id);
    expect(retrieved!.replyTo).toBe(original.id);
  });

  it('handles DM messages with to field', () => {
    const dm = createChatMessage('alice', 'room-1', 'private', 'bob');
    store.save(dm);

    const retrieved = store.getById(dm.id);
    expect(retrieved!.to).toBe('bob');
  });
});

describe('SqliteStore room persistence', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('saves and lists rooms', () => {
    store.saveRoom({ id: 'room-a', name: 'Room A' });
    store.saveRoom({ id: 'room-b', name: 'Room B' });

    const rooms = store.listRooms();
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r) => r.id)).toEqual(['room-a', 'room-b']);
    expect(rooms[0].name).toBe('Room A');
    expect(rooms[0].createdAt).toBeGreaterThan(0);
  });

  it('ignores duplicate room saves', () => {
    store.saveRoom({ id: 'room-a', name: 'Room A' });
    store.saveRoom({ id: 'room-a', name: 'Room A' });

    const rooms = store.listRooms();
    expect(rooms).toHaveLength(1);
  });

  it('deletes a room', () => {
    store.saveRoom({ id: 'room-a', name: 'Room A' });
    store.saveRoom({ id: 'room-b', name: 'Room B' });
    store.deleteRoom('room-a');

    const rooms = store.listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe('room-b');
  });

  it('returns empty list when no rooms', () => {
    expect(store.listRooms()).toEqual([]);
  });

  it('delete non-existent room is a no-op', () => {
    store.deleteRoom('ghost');
    expect(store.listRooms()).toEqual([]);
  });

  it('gets room by name', () => {
    store.saveRoom({ id: 'room-a', name: 'Room A' });
    const room = store.getRoomByName('Room A');
    expect(room).toBeDefined();
    expect(room!.id).toBe('room-a');
  });

  it('returns undefined for non-existent room name', () => {
    expect(store.getRoomByName('ghost')).toBeUndefined();
  });
});

describe('SqliteStore agents', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('saves and lists agents', () => {
    store.saveAgent({
      id: 'agent-1',
      name: 'Claude',
      type: AgentType.CLAUDE_CODE,
      role: 'developer',
      persona: 'helpful',
      createdAt: Date.now(),
    });

    const agents = store.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Claude');
    expect(agents[0].type).toBe(AgentType.CLAUDE_CODE);
    expect(agents[0].role).toBe('developer');
  });

  it('gets agent by id or name', () => {
    store.saveAgent({
      id: 'agent-1',
      name: 'Claude',
      type: AgentType.CLAUDE_CODE,
      createdAt: Date.now(),
    });

    const byId = store.getAgent('agent-1');
    expect(byId).toBeDefined();
    expect(byId!.name).toBe('Claude');

    const byName = store.getAgent('Claude');
    expect(byName).toBeDefined();
    expect(byName!.id).toBe('agent-1');
  });

  it('returns undefined for non-existent agent', () => {
    expect(store.getAgent('ghost')).toBeUndefined();
  });
});

describe('SqliteStore humans', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('saves and lists humans', () => {
    store.saveHuman({ id: 'human-1', name: 'Alice', createdAt: Date.now() });

    const humans = store.listHumans();
    expect(humans).toHaveLength(1);
    expect(humans[0].name).toBe('Alice');
  });

  it('gets human by id or name', () => {
    store.saveHuman({ id: 'human-1', name: 'Alice', createdAt: Date.now() });

    expect(store.getHuman('human-1')!.name).toBe('Alice');
    expect(store.getHuman('Alice')!.id).toBe('human-1');
  });

  it('returns undefined for non-existent human', () => {
    expect(store.getHuman('ghost')).toBeUndefined();
  });
});

describe('SqliteStore room membership', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('adds and retrieves room members', () => {
    store.saveRoom({ id: 'room-1', name: 'Room 1' });
    store.saveAgent({ id: 'agent-1', name: 'Claude', type: AgentType.CLAUDE_CODE, createdAt: Date.now() });
    store.saveHuman({ id: 'human-1', name: 'Alice', createdAt: Date.now() });

    store.addRoomMember('room-1', 'agent-1', 'agent');
    store.addRoomMember('room-1', 'human-1', 'human');

    const members = store.getRoomMembers('room-1');
    expect(members).toHaveLength(2);
    expect(members[0].memberId).toBe('agent-1');
    expect(members[0].memberType).toBe('agent');
    expect(members[1].memberId).toBe('human-1');
    expect(members[1].memberType).toBe('human');
  });

  it('removes a room member', () => {
    store.saveRoom({ id: 'room-1', name: 'Room 1' });
    store.addRoomMember('room-1', 'agent-1', 'agent');
    store.addRoomMember('room-1', 'human-1', 'human');

    store.removeRoomMember('room-1', 'agent-1');

    const members = store.getRoomMembers('room-1');
    expect(members).toHaveLength(1);
    expect(members[0].memberId).toBe('human-1');
  });

  it('deleting room cleans up members', () => {
    store.saveRoom({ id: 'room-1', name: 'Room 1' });
    store.addRoomMember('room-1', 'agent-1', 'agent');

    store.deleteRoom('room-1');

    const members = store.getRoomMembers('room-1');
    expect(members).toHaveLength(0);
  });

  it('ignores duplicate member adds', () => {
    store.saveRoom({ id: 'room-1', name: 'Room 1' });
    store.addRoomMember('room-1', 'agent-1', 'agent');
    store.addRoomMember('room-1', 'agent-1', 'agent');

    const members = store.getRoomMembers('room-1');
    expect(members).toHaveLength(1);
  });
});

describe('SqliteStore name uniqueness', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('returns true for unused name', () => {
    expect(store.checkNameUnique('fresh-name')).toBe(true);
  });

  it('returns false when name is used by a room', () => {
    store.saveRoom({ id: 'room-1', name: 'taken' });
    expect(store.checkNameUnique('taken')).toBe(false);
  });

  it('returns false when name is used by an agent', () => {
    store.saveAgent({ id: 'agent-1', name: 'taken', type: AgentType.CLAUDE_CODE, createdAt: Date.now() });
    expect(store.checkNameUnique('taken')).toBe(false);
  });

  it('returns false when name is used by a human', () => {
    store.saveHuman({ id: 'human-1', name: 'taken', createdAt: Date.now() });
    expect(store.checkNameUnique('taken')).toBe(false);
  });

  it('enforces uniqueness across entity types', () => {
    store.saveRoom({ id: 'room-1', name: 'shared-name' });
    expect(store.checkNameUnique('shared-name')).toBe(false);
    // Even though no agent or human uses it, the room does
  });
});
