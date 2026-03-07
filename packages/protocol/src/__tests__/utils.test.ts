import { describe, it, expect } from 'vitest';
import { createMessage, createChatMessage, serialize, deserialize, extractMentionNames } from '../utils.js';
import { MessageType } from '../types.js';

describe('createMessage', () => {
  it('generates id and timestamp when not provided', () => {
    const msg = createMessage({
      type: MessageType.CHAT,
      from: 'agent-1',
      to: null,
      payload: { text: 'hello' },
    });

    expect(msg.id).toBeDefined();
    expect(msg.id.length).toBeGreaterThan(0);
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.type).toBe(MessageType.CHAT);
    expect(msg.from).toBe('agent-1');
    expect(msg.to).toBeNull();
  });

  it('preserves provided id and timestamp', () => {
    const msg = createMessage({
      id: 'custom-id',
      timestamp: 12345,
      type: MessageType.CHAT,
      from: 'agent-1',
      to: null,
      payload: { text: 'hello' },
    });

    expect(msg.id).toBe('custom-id');
    expect(msg.timestamp).toBe(12345);
  });
});

describe('createChatMessage', () => {
  it('creates a chat message with correct fields', () => {
    const msg = createChatMessage('alice', 'Hello!');

    expect(msg.type).toBe(MessageType.CHAT);
    expect(msg.from).toBe('alice');
    expect(msg.to).toBeNull();
    expect(msg.payload).toEqual({ text: 'Hello!' });
  });

  it('includes mentions when provided', () => {
    const msg = createChatMessage('alice', 'Hey @bob @charlie', ['bob-id', 'charlie-id']);

    expect(msg.to).toBeNull();
    expect(msg.mentions).toEqual(['bob-id', 'charlie-id']);
  });

  it('omits mentions when empty', () => {
    const msg = createChatMessage('alice', 'Hello', []);

    expect(msg.mentions).toBeUndefined();
  });
});

describe('extractMentionNames', () => {
  it('extracts single mention', () => {
    expect(extractMentionNames('Hello @bob')).toEqual(['bob']);
  });

  it('extracts multiple mentions', () => {
    const names = extractMentionNames('@alice @bob please discuss');
    expect(names).toContain('alice');
    expect(names).toContain('bob');
    expect(names).toHaveLength(2);
  });

  it('deduplicates mentions (case insensitive)', () => {
    expect(extractMentionNames('@Bob @bob hello')).toEqual(['bob']);
  });

  it('returns empty array when no mentions', () => {
    expect(extractMentionNames('no mentions here')).toEqual([]);
  });

  it('handles mentions with hyphens and UUIDs', () => {
    const names = extractMentionNames('@claude-code-19aa169c hi');
    expect(names).toEqual(['claude-code-19aa169c']);
  });
});

describe('serialize / deserialize', () => {
  it('roundtrips a message', () => {
    const original = createChatMessage('alice', 'test message');
    const serialized = serialize(original);
    const deserialized = deserialize(serialized);

    expect(deserialized).toEqual(original);
  });

  it('serializes to valid JSON string', () => {
    const msg = createChatMessage('alice', 'hello');
    const json = serialize(msg);

    expect(typeof json).toBe('string');
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
