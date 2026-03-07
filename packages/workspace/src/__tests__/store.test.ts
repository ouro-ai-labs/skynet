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
        to: null,
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

  it('handles DM messages with to field', () => {
    const dm = createChatMessage('alice', 'private', 'bob');
    store.save(dm);

    const retrieved = store.getById(dm.id);
    expect(retrieved!.to).toBe('bob');
  });

  it('handles messages with mentions', () => {
    const msg = createChatMessage('alice', 'hey @bob @charlie', null, ['bob-id', 'charlie-id']);
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
        to: null,
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

  it('getMessagesFor returns messages addressed to or mentioning the agent', () => {
    // Broadcast (no to, no mentions)
    store.save(createChatMessage('alice', 'broadcast'));
    // DM to bob
    store.save(createChatMessage('alice', 'dm for bob', 'bob-id'));
    // Mentions bob
    store.save(createChatMessage('alice', 'hey @bob', null, ['bob-id']));
    // DM to charlie
    store.save(createChatMessage('alice', 'dm for charlie', 'charlie-id'));

    const bobMessages = store.getMessagesFor('bob-id');
    expect(bobMessages).toHaveLength(2);
    const texts = bobMessages.map(m => (m.payload as { text: string }).text);
    expect(texts).toContain('dm for bob');
    expect(texts).toContain('hey @bob');
  });

  it('getMessagesFor respects limit', () => {
    for (let i = 0; i < 10; i++) {
      store.save(createChatMessage('alice', `dm ${i}`, 'bob-id'));
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
        to: 'bob-id',
        timestamp: 1000 + i,
        payload: { text: `dm ${i}` },
      });
      store.save(msg);
    }

    // Only messages after timestamp 1002
    const messages = store.getMessagesFor('bob-id', 10, 1002);
    expect(messages).toHaveLength(2);
    const texts = messages.map(m => (m.payload as { text: string }).text);
    expect(texts).toEqual(['dm 3', 'dm 4']);
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
    store.saveAgent({ id: 'agent-1', name: 'taken', type: AgentType.CLAUDE_CODE, createdAt: Date.now() });
    expect(store.checkNameUnique('taken')).toBe(false);
  });

  it('returns false when name is used by a human', () => {
    store.saveHuman({ id: 'human-1', name: 'taken', createdAt: Date.now() });
    expect(store.checkNameUnique('taken')).toBe(false);
  });
});
