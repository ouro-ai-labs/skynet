import { randomUUID } from 'node:crypto';
import { MessageType, type SkynetMessage } from './types.js';

export function createMessage(
  partial: Omit<SkynetMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: number },
): SkynetMessage {
  return {
    id: partial.id ?? randomUUID(),
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  };
}

export function createChatMessage(
  from: string,
  text: string,
  to: string | null = null,
  mentions?: string[],
): SkynetMessage {
  return createMessage({
    type: MessageType.CHAT,
    from,
    to,
    payload: { text },
    ...(mentions && mentions.length > 0 ? { mentions } : {}),
  });
}

/**
 * Extract @name tokens from message text.
 * Returns the list of unique lowercased names found after '@'.
 */
export function extractMentionNames(text: string): string[] {
  const matches = text.match(/@(\S+)/g);
  if (!matches) return [];
  const names = new Set<string>();
  for (const m of matches) {
    names.add(m.slice(1).toLowerCase());
  }
  return Array.from(names);
}

export function serialize(msg: SkynetMessage): string {
  return JSON.stringify(msg);
}

export function deserialize(raw: string): SkynetMessage {
  return JSON.parse(raw) as SkynetMessage;
}
