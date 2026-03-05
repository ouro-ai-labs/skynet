import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageStore } from '../store.js';
import { createChatMessage, createMessage, MessageType } from '@skynet/protocol';

describe('MessageStore', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore(':memory:');
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
