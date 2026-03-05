import { describe, it, expect } from 'vitest';
import { createMessage, createChatMessage, serialize, deserialize } from '../utils.js';
import { MessageType } from '../types.js';

describe('createMessage', () => {
  it('generates id and timestamp when not provided', () => {
    const msg = createMessage({
      type: MessageType.CHAT,
      from: 'agent-1',
      to: null,
      roomId: 'room-1',
      payload: { text: 'hello' },
    });

    expect(msg.id).toBeDefined();
    expect(msg.id.length).toBeGreaterThan(0);
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.type).toBe(MessageType.CHAT);
    expect(msg.from).toBe('agent-1');
    expect(msg.to).toBeNull();
    expect(msg.roomId).toBe('room-1');
  });

  it('preserves provided id and timestamp', () => {
    const msg = createMessage({
      id: 'custom-id',
      timestamp: 12345,
      type: MessageType.CHAT,
      from: 'agent-1',
      to: null,
      roomId: 'room-1',
      payload: { text: 'hello' },
    });

    expect(msg.id).toBe('custom-id');
    expect(msg.timestamp).toBe(12345);
  });
});

describe('createChatMessage', () => {
  it('creates a chat message with correct fields', () => {
    const msg = createChatMessage('alice', 'room-1', 'Hello!');

    expect(msg.type).toBe(MessageType.CHAT);
    expect(msg.from).toBe('alice');
    expect(msg.to).toBeNull();
    expect(msg.roomId).toBe('room-1');
    expect(msg.payload).toEqual({ text: 'Hello!' });
  });

  it('supports DM with to field', () => {
    const msg = createChatMessage('alice', 'room-1', 'Hey Bob', 'bob');

    expect(msg.to).toBe('bob');
  });
});

describe('serialize / deserialize', () => {
  it('roundtrips a message', () => {
    const original = createChatMessage('alice', 'room-1', 'test message');
    const serialized = serialize(original);
    const deserialized = deserialize(serialized);

    expect(deserialized).toEqual(original);
  });

  it('serializes to valid JSON string', () => {
    const msg = createChatMessage('alice', 'room-1', 'hello');
    const json = serialize(msg);

    expect(typeof json).toBe('string');
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
