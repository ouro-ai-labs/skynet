import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../sqlite-store.js';
import { createChatMessage, createMessage, MessageType, AgentType, MENTION_ALL } from '@skynet-ai/protocol';

/**
 * Supplementary tests for SqliteStore covering edge cases not in store.test.ts:
 * - corrupt/invalid JSON in payload and mentions columns
 * - after-timestamp filtering in getMessages
 * - combined before+after filtering
 * - name uniqueness across agents and humans
 */
describe('SqliteStore edge cases', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // ── Corrupt JSON handling ──

  describe('corrupt JSON in stored data', () => {
    it('throws when payload contains invalid JSON', () => {
      // Directly insert a row with invalid JSON payload via the underlying DB
      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      db.prepare(
        'INSERT INTO messages (id, type, "from", timestamp, payload, reply_to, mentions) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('bad-1', 'chat', 'alice', 1000, '{invalid json', null, null);

      expect(() => store.getById('bad-1')).toThrow();
    });

    it('throws when mentions contains invalid JSON', () => {
      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      db.prepare(
        'INSERT INTO messages (id, type, "from", timestamp, payload, reply_to, mentions) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('bad-2', 'chat', 'alice', 1000, '{"text":"hello"}', null, 'not-json');

      expect(() => store.getById('bad-2')).toThrow();
    });
  });

  // ── getMessages with after parameter ──

  describe('getMessages after-timestamp filtering', () => {
    it('returns only messages after the given timestamp', () => {
      for (let i = 0; i < 5; i++) {
        store.save(createMessage({
          type: MessageType.CHAT,
          from: 'alice',
          timestamp: 1000 + i,
          payload: { text: `msg ${i}` },
        }));
      }

      const after = store.getMessages(10, undefined, 1002);
      expect(after).toHaveLength(2);
      expect((after[0].payload as { text: string }).text).toBe('msg 3');
      expect((after[1].payload as { text: string }).text).toBe('msg 4');
    });

    it('combines before and after filters', () => {
      for (let i = 0; i < 10; i++) {
        store.save(createMessage({
          type: MessageType.CHAT,
          from: 'alice',
          timestamp: 1000 + i,
          payload: { text: `msg ${i}` },
        }));
      }

      // After 1002, before 1007 → timestamps 1003, 1004, 1005, 1006
      const range = store.getMessages(100, 1007, 1002);
      expect(range).toHaveLength(4);
      const texts = range.map(m => (m.payload as { text: string }).text);
      expect(texts).toEqual(['msg 3', 'msg 4', 'msg 5', 'msg 6']);
    });
  });

  // ── Messages with null mentions stored correctly ──

  describe('mentions storage', () => {
    it('stores null mentions when mentions array is empty', () => {
      const msg = createChatMessage('alice', 'broadcast', []);
      store.save(msg);

      const retrieved = store.getById(msg.id);
      expect(retrieved).toBeDefined();
      // Empty mentions array becomes undefined on retrieval
      expect(retrieved!.mentions).toBeUndefined();
    });

    it('stores null mentions when mentions is undefined', () => {
      const msg = createChatMessage('alice', 'no mentions');
      store.save(msg);

      const retrieved = store.getById(msg.id);
      expect(retrieved!.mentions).toBeUndefined();
    });
  });

  // ── getMessagesFor with @all ──

  describe('getMessagesFor with MENTION_ALL', () => {
    it('returns @all messages for any agent ID', () => {
      store.save(createChatMessage('alice', 'hey all', [MENTION_ALL]));
      store.save(createChatMessage('alice', 'only bob', ['bob-id']));

      const charlieMessages = store.getMessagesFor('charlie-id');
      expect(charlieMessages).toHaveLength(1);
      expect((charlieMessages[0].payload as { text: string }).text).toBe('hey all');
    });
  });

  // ── Name uniqueness across agents and humans ──

  describe('cross-entity name uniqueness', () => {
    it('agent name blocks human with same name', () => {
      store.saveAgent({
        id: 'agent-1',
        name: 'shared-name',
        type: AgentType.CLAUDE_CODE,
        createdAt: Date.now(),
        status: 'offline',
      });
      expect(store.checkNameUnique('shared-name')).toBe(false);
    });

    it('human name blocks agent with same name', () => {
      store.saveHuman({ id: 'human-1', name: 'shared-name', createdAt: Date.now() });
      expect(store.checkNameUnique('shared-name')).toBe(false);
    });
  });

  // ── INSERT OR REPLACE behavior ──

  describe('save idempotency', () => {
    it('updates payload on re-save with same id', () => {
      const msg = createChatMessage('alice', 'original');
      store.save(msg);
      store.save({ ...msg, payload: { text: 'updated' } });

      const retrieved = store.getById(msg.id);
      expect((retrieved!.payload as { text: string }).text).toBe('updated');
    });
  });
});
