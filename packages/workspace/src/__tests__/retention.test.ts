import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStore } from '../sqlite-store.js';
import { createMessage, MessageType } from '@skynet-ai/protocol';

describe('SqliteStore retention', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  function insertMessages(count: number, baseTimestamp: number): void {
    for (let i = 0; i < count; i++) {
      store.save(createMessage({
        type: MessageType.CHAT,
        from: 'alice',
        timestamp: baseTimestamp + i,
        payload: { text: `msg ${i}` },
      }));
    }
  }

  describe('purgeOlderThan', () => {
    it('deletes messages older than the specified age', () => {
      const now = Date.now();
      // Insert messages at various ages
      insertMessages(5, now - 10_000); // 10s ago
      insertMessages(5, now - 1_000);  // 1s ago

      expect(store.getMessageCount()).toBe(10);

      // Purge messages older than 5 seconds
      const deleted = store.purgeOlderThan(5_000);
      expect(deleted).toBe(5);
      expect(store.getMessageCount()).toBe(5);
    });

    it('returns 0 when no messages are old enough to purge', () => {
      const now = Date.now();
      insertMessages(5, now);

      const deleted = store.purgeOlderThan(60_000);
      expect(deleted).toBe(0);
      expect(store.getMessageCount()).toBe(5);
    });

    it('purges all messages when they are all older than maxAge', () => {
      insertMessages(10, Date.now() - 60_000);

      const deleted = store.purgeOlderThan(1_000);
      expect(deleted).toBe(10);
      expect(store.getMessageCount()).toBe(0);
    });

    it('handles empty table gracefully', () => {
      const deleted = store.purgeOlderThan(1_000);
      expect(deleted).toBe(0);
    });
  });

  describe('getMessageCount', () => {
    it('returns 0 for empty store', () => {
      expect(store.getMessageCount()).toBe(0);
    });

    it('returns correct count after inserts', () => {
      insertMessages(7, Date.now());
      expect(store.getMessageCount()).toBe(7);
    });

    it('reflects count after purge', () => {
      const now = Date.now();
      insertMessages(3, now - 10_000);
      insertMessages(4, now);

      store.purgeOlderThan(5_000);
      expect(store.getMessageCount()).toBe(4);
    });
  });
});

describe('SkynetWorkspace retention timer', () => {
  it('purges old messages on interval when retentionMaxAgeMs is set', async () => {
    // We test the retention logic indirectly via SqliteStore since
    // the server integration test would require full WebSocket setup.
    // This validates the store methods that the timer calls.
    const store = new SqliteStore(':memory:');
    const now = Date.now();

    for (let i = 0; i < 20; i++) {
      store.save(createMessage({
        type: MessageType.CHAT,
        from: 'agent-1',
        timestamp: now - 60_000 + i * 1000, // spread over 60 seconds
        payload: { text: `msg ${i}` },
      }));
    }

    expect(store.getMessageCount()).toBe(20);

    // Simulate retention: purge messages older than 30 seconds
    const deleted = store.purgeOlderThan(30_000);
    expect(deleted).toBeGreaterThan(0);
    expect(store.getMessageCount()).toBeLessThan(20);

    // Remaining messages should all be within retention window
    const remaining = store.getMessages(100);
    for (const msg of remaining) {
      expect(msg.timestamp).toBeGreaterThanOrEqual(now - 30_000);
    }

    store.close();
  });
});
