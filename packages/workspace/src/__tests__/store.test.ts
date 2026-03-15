import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../sqlite-store.js';
import { createChatMessage, createMessage, createExecutionLog, MessageType, AgentType, MENTION_ALL } from '@skynet-ai/protocol';
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
    const msg = createChatMessage('alice', 'hello');
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

  it('retrieves messages', () => {
    store.save(createChatMessage('alice', 'msg 1'));
    store.save(createChatMessage('bob', 'msg 2'));

    const messages = store.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].from).toBe('alice');
    expect(messages[1].from).toBe('bob');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      store.save(createChatMessage('alice', `msg ${i}`));
    }

    const messages = store.getMessages(3);
    expect(messages).toHaveLength(3);
  });

  it('supports before parameter for pagination', () => {
    for (let i = 0; i < 5; i++) {
      const msg = createMessage({
        type: MessageType.CHAT,
        from: 'alice',
        timestamp: 1000 + i,
        payload: { text: `msg ${i}` },
      });
      store.save(msg);
    }

    const before = store.getMessages(10, 1003);
    expect(before).toHaveLength(3);
    expect((before[0].payload as { text: string }).text).toBe('msg 0');
  });

  it('handles messages with replyTo', () => {
    const original = createChatMessage('alice', 'original');
    store.save(original);

    const reply = createMessage({
      type: MessageType.CHAT,
      from: 'bob',
      to: null,
      payload: { text: 'reply' },
      replyTo: original.id,
    });
    store.save(reply);

    const retrieved = store.getById(reply.id);
    expect(retrieved!.replyTo).toBe(original.id);
  });

  it('handles DM messages via mentions', () => {
    const dm = createChatMessage('alice', 'private', ['bob-id']);
    store.save(dm);

    const retrieved = store.getById(dm.id);
    expect(retrieved!.mentions).toEqual(['bob-id']);
  });

  it('handles messages with mentions', () => {
    const msg = createChatMessage('alice', 'hey @bob @charlie', ['bob-id', 'charlie-id']);
    store.save(msg);

    const retrieved = store.getById(msg.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.mentions).toEqual(['bob-id', 'charlie-id']);
  });

  it('idempotent save (INSERT OR REPLACE)', () => {
    const msg = createChatMessage('alice', 'original');
    store.save(msg);
    store.save({ ...msg, payload: { text: 'updated' } });

    const retrieved = store.getById(msg.id);
    expect((retrieved!.payload as { text: string }).text).toBe('updated');

    const all = store.getMessages();
    expect(all).toHaveLength(1);
  });

  it('getMessages returns empty when no messages', () => {
    expect(store.getMessages()).toEqual([]);
  });

  it('getMessages returns in chronological order', () => {
    for (let i = 0; i < 5; i++) {
      const msg = createMessage({
        type: MessageType.CHAT,
        from: 'alice',
        timestamp: 1000 + i,
        payload: { text: `msg ${i}` },
      });
      store.save(msg);
    }

    const messages = store.getMessages();
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].timestamp).toBeGreaterThanOrEqual(messages[i - 1].timestamp);
    }
  });

  it('getMessagesFor returns messages mentioning the agent', () => {
    // No mentions
    store.save(createChatMessage('alice', 'broadcast'));
    // Mentions bob
    store.save(createChatMessage('alice', 'dm for bob', ['bob-id']));
    // Also mentions bob
    store.save(createChatMessage('alice', 'hey @bob', ['bob-id']));
    // Mentions charlie only
    store.save(createChatMessage('alice', 'dm for charlie', ['charlie-id']));

    const bobMessages = store.getMessagesFor('bob-id');
    expect(bobMessages).toHaveLength(2);
    const texts = bobMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('dm for bob');
    expect(texts).toContain('hey @bob');
  });

  it('getMessagesFor respects limit', () => {
    for (let i = 0; i < 10; i++) {
      store.save(createChatMessage('alice', `dm ${i}`, ['bob-id']));
    }

    const messages = store.getMessagesFor('bob-id', 3);
    expect(messages).toHaveLength(3);
    // Should be the most recent 3, in chronological order
    const texts = messages.map(m => (m.payload as { text: string }).text);
    expect(texts).toEqual(['dm 7', 'dm 8', 'dm 9']);
  });

  it('getMessagesFor returns empty when no matching messages', () => {
    store.save(createChatMessage('alice', 'broadcast'));
    expect(store.getMessagesFor('bob-id')).toEqual([]);
  });

  it('getMessagesFor filters by since timestamp', () => {
    for (let i = 0; i < 5; i++) {
      const msg = createMessage({
        type: MessageType.CHAT,
        from: 'alice',
        timestamp: 1000 + i,
        payload: { text: `dm ${i}` },
        mentions: ['bob-id'],
      });
      store.save(msg);
    }

    // Only messages after timestamp 1002
    const messages = store.getMessagesFor('bob-id', 10, 1002);
    expect(messages).toHaveLength(2);
    const texts = messages.map(m => (m.payload as { text: string }).text);
    expect(texts).toEqual(['dm 3', 'dm 4']);
  });

  it('getMessagesFor matches @all mentions', () => {
    store.save(createChatMessage('alice', 'hello everyone', [MENTION_ALL]));
    store.save(createChatMessage('alice', 'only for charlie', ['charlie-id']));

    const bobMessages = store.getMessagesFor('bob-id');
    expect(bobMessages).toHaveLength(1);
    expect((bobMessages[0].payload as { text: string }).text).toBe('hello everyone');
  });
});

describe('SqliteStore execution logs', () => {
  let store: Store;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('returns execution logs filtered by type', () => {
    // Save a mix of chat and execution log messages
    store.save(createChatMessage('alice', 'hello'));
    store.save(createExecutionLog('agent-1', 'tool.call', 'Read file.ts'));
    store.save(createExecutionLog('agent-1', 'tool.result', 'done'));
    store.save(createChatMessage('bob', 'world'));

    const logs = store.getExecutionLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].type).toBe(MessageType.EXECUTION_LOG);
    expect(logs[1].type).toBe(MessageType.EXECUTION_LOG);
  });

  it('filters execution logs by agent ID', () => {
    store.save(createExecutionLog('agent-1', 'tool.call', 'Read'));
    store.save(createExecutionLog('agent-2', 'tool.call', 'Write'));
    store.save(createExecutionLog('agent-1', 'processing.end', 'Done'));

    const agent1Logs = store.getExecutionLogs('agent-1');
    expect(agent1Logs).toHaveLength(2);
    expect(agent1Logs.every((l) => l.from === 'agent-1')).toBe(true);

    const agent2Logs = store.getExecutionLogs('agent-2');
    expect(agent2Logs).toHaveLength(1);
    expect(agent2Logs[0].from).toBe('agent-2');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      store.save(createExecutionLog('agent-1', 'tool.call', `tool ${i}`));
    }

    const logs = store.getExecutionLogs(undefined, 3);
    expect(logs).toHaveLength(3);
  });

  it('returns empty array when no execution logs exist', () => {
    store.save(createChatMessage('alice', 'hello'));
    expect(store.getExecutionLogs()).toEqual([]);
  });

  it('returns logs in chronological order', () => {
    for (let i = 0; i < 5; i++) {
      const log = createExecutionLog('agent-1', 'tool.call', `tool ${i}`);
      store.save({ ...log, timestamp: 1000 + i });
    }

    const logs = store.getExecutionLogs();
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].timestamp).toBeGreaterThanOrEqual(logs[i - 1].timestamp);
    }
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
      status: 'offline',
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
      status: 'offline',
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

  it('deletes agent by id', () => {
    store.saveAgent({ id: 'agent-1', name: 'Claude', type: AgentType.CLAUDE_CODE, createdAt: Date.now(), status: 'offline' });
    expect(store.deleteAgent('agent-1')).toBe(true);
    expect(store.getAgent('agent-1')).toBeUndefined();
    expect(store.listAgents()).toHaveLength(0);
  });

  it('does not delete agent by name', () => {
    store.saveAgent({ id: 'agent-1', name: 'Claude', type: AgentType.CLAUDE_CODE, createdAt: Date.now(), status: 'offline' });
    expect(store.deleteAgent('Claude')).toBe(false);
    expect(store.getAgent('agent-1')).toBeDefined();
  });

  it('returns false when deleting non-existent agent', () => {
    expect(store.deleteAgent('ghost')).toBe(false);
  });

  it('frees name after agent deletion', () => {
    store.saveAgent({ id: 'agent-1', name: 'Claude', type: AgentType.CLAUDE_CODE, createdAt: Date.now(), status: 'offline' });
    expect(store.checkNameUnique('Claude')).toBe(false);
    store.deleteAgent('agent-1');
    expect(store.checkNameUnique('Claude')).toBe(true);
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

  it('deletes human by id', () => {
    store.saveHuman({ id: 'human-1', name: 'Alice', createdAt: Date.now() });
    expect(store.deleteHuman('human-1')).toBe(true);
    expect(store.getHuman('human-1')).toBeUndefined();
    expect(store.listHumans()).toHaveLength(0);
  });

  it('does not delete human by name', () => {
    store.saveHuman({ id: 'human-1', name: 'Alice', createdAt: Date.now() });
    expect(store.deleteHuman('Alice')).toBe(false);
    expect(store.getHuman('human-1')).toBeDefined();
  });

  it('returns false when deleting non-existent human', () => {
    expect(store.deleteHuman('ghost')).toBe(false);
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

  it('returns false when name is used by an agent', () => {
    store.saveAgent({ id: 'agent-1', name: 'taken', type: AgentType.CLAUDE_CODE, createdAt: Date.now(), status: 'offline' });
    expect(store.checkNameUnique('taken')).toBe(false);
  });

  it('returns false when name is used by a human', () => {
    store.saveHuman({ id: 'human-1', name: 'taken', createdAt: Date.now() });
    expect(store.checkNameUnique('taken')).toBe(false);
  });
});
