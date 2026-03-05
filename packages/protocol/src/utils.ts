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
  roomId: string,
  text: string,
  to: string | null = null,
): SkynetMessage {
  return createMessage({
    type: MessageType.CHAT,
    from,
    to,
    roomId,
    payload: { text },
  });
}

export function serialize(msg: SkynetMessage): string {
  return JSON.stringify(msg);
}

export function deserialize(raw: string): SkynetMessage {
  return JSON.parse(raw) as SkynetMessage;
}
