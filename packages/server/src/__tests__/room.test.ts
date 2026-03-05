import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Room, RoomManager } from '../room.js';
import { AgentType, createChatMessage } from '@skynet/protocol';
import type { AgentCard } from '@skynet/protocol';
import type { WebSocket } from 'ws';

function mockSocket(open = true): WebSocket {
  return {
    readyState: open ? 1 : 3, // OPEN = 1, CLOSED = 3
    OPEN: 1,
    send: vi.fn(),
  } as unknown as WebSocket;
}

function mockAgent(id: string, name: string): AgentCard {
  return {
    agentId: id,
    name,
    type: AgentType.HUMAN,
    capabilities: ['chat'],
    status: 'idle',
  };
}

describe('Room', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('test-room');
  });

  it('allows agents to join and leave', () => {
    const agent = mockAgent('a1', 'alice');
    const socket = mockSocket();

    room.join(agent, socket);
    expect(room.size).toBe(1);
    expect(room.getMembers()).toHaveLength(1);
    expect(room.getMembers()[0].name).toBe('alice');

    room.leave('a1');
    expect(room.size).toBe(0);
  });

  it('returns member by id', () => {
    const agent = mockAgent('a1', 'alice');
    const socket = mockSocket();
    room.join(agent, socket);

    expect(room.getMember('a1')).toBeDefined();
    expect(room.getMember('a1')!.agent.name).toBe('alice');
    expect(room.getMember('nonexistent')).toBeUndefined();
  });

  it('broadcasts message to all except sender', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    const s3 = mockSocket();
    room.join(mockAgent('a1', 'alice'), s1);
    room.join(mockAgent('a2', 'bob'), s2);
    room.join(mockAgent('a3', 'charlie'), s3);

    const msg = createChatMessage('a1', 'test-room', 'hello');
    room.broadcast(msg, 'a1');

    expect(s1.send).not.toHaveBeenCalled();
    expect(s2.send).toHaveBeenCalledOnce();
    expect(s3.send).toHaveBeenCalledOnce();
  });

  it('broadcasts to all when no excludeAgentId', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    room.join(mockAgent('a1', 'alice'), s1);
    room.join(mockAgent('a2', 'bob'), s2);

    const msg = createChatMessage('a1', 'test-room', 'hello');
    room.broadcast(msg);

    expect(s1.send).toHaveBeenCalledOnce();
    expect(s2.send).toHaveBeenCalledOnce();
  });

  it('skips closed sockets on broadcast', () => {
    const openSocket = mockSocket(true);
    const closedSocket = mockSocket(false);
    room.join(mockAgent('a1', 'alice'), openSocket);
    room.join(mockAgent('a2', 'bob'), closedSocket);

    const msg = createChatMessage('a3', 'test-room', 'hello');
    room.broadcast(msg);

    expect(openSocket.send).toHaveBeenCalledOnce();
    expect(closedSocket.send).not.toHaveBeenCalled();
  });

  it('sends direct message to specific agent', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    room.join(mockAgent('a1', 'alice'), s1);
    room.join(mockAgent('a2', 'bob'), s2);

    const msg = createChatMessage('a1', 'test-room', 'hey bob', 'a2');
    const sent = room.sendTo('a2', msg);

    expect(sent).toBe(true);
    expect(s2.send).toHaveBeenCalledOnce();
    expect(s1.send).not.toHaveBeenCalled();
  });

  it('returns false when sending to non-existent agent', () => {
    const result = room.sendTo('non-existent', createChatMessage('a1', 'test-room', 'hello'));
    expect(result).toBe(false);
  });

  it('updates agent status', () => {
    room.join(mockAgent('a1', 'alice'), mockSocket());
    expect(room.getMember('a1')!.agent.status).toBe('idle');

    room.updateStatus('a1', 'busy');
    expect(room.getMember('a1')!.agent.status).toBe('busy');
  });
});

describe('RoomManager', () => {
  it('creates rooms on demand', () => {
    const mgr = new RoomManager();
    const room = mgr.getOrCreate('room-1');

    expect(room.id).toBe('room-1');
    expect(mgr.get('room-1')).toBe(room);
  });

  it('returns same room instance', () => {
    const mgr = new RoomManager();
    const r1 = mgr.getOrCreate('room-1');
    const r2 = mgr.getOrCreate('room-1');

    expect(r1).toBe(r2);
  });

  it('lists rooms with member counts', () => {
    const mgr = new RoomManager();
    mgr.getOrCreate('room-1').join(mockAgent('a1', 'alice'), mockSocket());
    mgr.getOrCreate('room-2');

    const list = mgr.listRooms();
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.id === 'room-1')!.memberCount).toBe(1);
    expect(list.find((r) => r.id === 'room-2')!.memberCount).toBe(0);
  });

  it('removes empty rooms', () => {
    const mgr = new RoomManager();
    mgr.getOrCreate('room-1');
    mgr.removeIfEmpty('room-1');

    expect(mgr.get('room-1')).toBeUndefined();
  });

  it('does not remove non-empty rooms', () => {
    const mgr = new RoomManager();
    mgr.getOrCreate('room-1').join(mockAgent('a1', 'alice'), mockSocket());
    mgr.removeIfEmpty('room-1');

    expect(mgr.get('room-1')).toBeDefined();
  });

  it('creates a new room explicitly', () => {
    const mgr = new RoomManager();
    const room = mgr.create('new-room');

    expect(room).not.toBeNull();
    expect(room!.id).toBe('new-room');
    expect(mgr.get('new-room')).toBe(room);
  });

  it('returns null when creating a room that already exists', () => {
    const mgr = new RoomManager();
    mgr.create('dup-room');
    const second = mgr.create('dup-room');

    expect(second).toBeNull();
  });

  it('removes a room and closes member sockets', () => {
    const mgr = new RoomManager();
    const room = mgr.getOrCreate('rm-room');
    const socket = mockSocket(true);
    (socket as unknown as { close: ReturnType<typeof vi.fn> }).close = vi.fn();
    room.join(mockAgent('a1', 'alice'), socket);

    const result = mgr.remove('rm-room');

    expect(result.removed).toBe(true);
    expect(mgr.get('rm-room')).toBeUndefined();
    expect(
      (socket as unknown as { close: ReturnType<typeof vi.fn> }).close,
    ).toHaveBeenCalledWith(1000, 'Room destroyed');
  });

  it('returns not found when removing non-existent room', () => {
    const mgr = new RoomManager();
    const result = mgr.remove('ghost');

    expect(result.removed).toBe(false);
    expect(result.reason).toBe('Room not found');
  });
});
