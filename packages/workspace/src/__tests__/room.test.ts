import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemberManager } from '../member-manager.js';
import { AgentType, createChatMessage } from '@skynet-ai/protocol';
import type { AgentCard } from '@skynet-ai/protocol';
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
    id,
    name,
    type: AgentType.HUMAN,
    status: 'offline',
  };
}

describe('MemberManager', () => {
  let members: MemberManager;

  beforeEach(() => {
    members = new MemberManager();
  });

  it('allows agents to join and leave', () => {
    const agent = mockAgent('a1', 'alice');
    const socket = mockSocket();

    members.join(agent, socket);
    expect(members.size).toBe(1);
    expect(members.getMembers()).toHaveLength(1);
    expect(members.getMembers()[0].name).toBe('alice');

    members.leave('a1');
    expect(members.size).toBe(0);
  });

  it('returns member by id', () => {
    const agent = mockAgent('a1', 'alice');
    const socket = mockSocket();
    members.join(agent, socket);

    expect(members.getMember('a1')).toBeDefined();
    expect(members.getMember('a1')!.agent.name).toBe('alice');
    expect(members.getMember('nonexistent')).toBeUndefined();
  });

  it('broadcasts message to all except sender', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    const s3 = mockSocket();
    members.join(mockAgent('a1', 'alice'), s1);
    members.join(mockAgent('a2', 'bob'), s2);
    members.join(mockAgent('a3', 'charlie'), s3);

    const msg = createChatMessage('a1', 'hello');
    members.broadcast(msg, 'a1');

    expect(s1.send).not.toHaveBeenCalled();
    expect(s2.send).toHaveBeenCalledOnce();
    expect(s3.send).toHaveBeenCalledOnce();
  });

  it('broadcasts to all when no excludeAgentId', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    members.join(mockAgent('a1', 'alice'), s1);
    members.join(mockAgent('a2', 'bob'), s2);

    const msg = createChatMessage('a1', 'hello');
    members.broadcast(msg);

    expect(s1.send).toHaveBeenCalledOnce();
    expect(s2.send).toHaveBeenCalledOnce();
  });

  it('skips closed sockets on broadcast', () => {
    const openSocket = mockSocket(true);
    const closedSocket = mockSocket(false);
    members.join(mockAgent('a1', 'alice'), openSocket);
    members.join(mockAgent('a2', 'bob'), closedSocket);

    const msg = createChatMessage('a3', 'hello');
    members.broadcast(msg);

    expect(openSocket.send).toHaveBeenCalledOnce();
    expect(closedSocket.send).not.toHaveBeenCalled();
  });

  it('sends direct message to specific agent', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    members.join(mockAgent('a1', 'alice'), s1);
    members.join(mockAgent('a2', 'bob'), s2);

    const msg = createChatMessage('a1', 'hey bob', 'a2');
    const sent = members.sendTo('a2', msg);

    expect(sent).toBe(true);
    expect(s2.send).toHaveBeenCalledOnce();
    expect(s1.send).not.toHaveBeenCalled();
  });

  it('returns false when sending to non-existent agent', () => {
    const result = members.sendTo('non-existent', createChatMessage('a1', 'hello'));
    expect(result).toBe(false);
  });

  it('updates agent status', () => {
    members.join(mockAgent('a1', 'alice'), mockSocket());
    expect(members.getMember('a1')!.agent.status).toBe('offline');

    members.updateStatus('a1', 'busy');
    expect(members.getMember('a1')!.agent.status).toBe('busy');
  });

  it('updateStatus is a no-op for non-existent agent', () => {
    members.updateStatus('nonexistent', 'busy');
    expect(members.getMember('nonexistent')).toBeUndefined();
  });

  it('sendTo returns false for closed socket', () => {
    const closedSocket = mockSocket(false);
    members.join(mockAgent('a1', 'alice'), closedSocket);

    const msg = createChatMessage('a2', 'hello');
    const result = members.sendTo('a1', msg);

    expect(result).toBe(false);
    expect(closedSocket.send).not.toHaveBeenCalled();
  });

  it('replaces existing member on re-join', () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    const agent = mockAgent('a1', 'alice');

    members.join(agent, s1);
    members.join(agent, s2);

    expect(members.size).toBe(1);

    const msg = createChatMessage('a2', 'hello');
    members.sendTo('a1', msg);

    expect(s1.send).not.toHaveBeenCalled();
    expect(s2.send).toHaveBeenCalledOnce();
  });

  it('leave is a no-op for non-existent agent', () => {
    members.leave('nonexistent');
    expect(members.size).toBe(0);
  });

  it('getMembers returns empty array when no members', () => {
    expect(members.getMembers()).toEqual([]);
    expect(members.size).toBe(0);
  });

  it('broadcast serializes message correctly', () => {
    const s1 = mockSocket();
    members.join(mockAgent('a1', 'alice'), s1);

    const msg = createChatMessage('a2', 'hello');
    members.broadcast(msg);

    const sent = JSON.parse((s1.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(sent.type).toBe('chat');
    expect(sent.from).toBe('a2');
    expect(sent.payload).toEqual({ text: 'hello' });
  });
});
