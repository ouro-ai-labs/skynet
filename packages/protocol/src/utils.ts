import { randomUUID } from 'node:crypto';
import { MessageType, type SkynetMessage, type ExecutionLogEvent, type ExecutionLogLevel, type ExecutionLogPayload } from './types.js';

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
  mentions?: string[],
): SkynetMessage {
  return createMessage({
    type: MessageType.CHAT,
    from,
    payload: { text },
    ...(mentions && mentions.length > 0 ? { mentions } : {}),
  });
}

/**
 * Extract @name tokens from message text.
 * Returns the list of unique lowercased names found after '@'.
 * Strips surrounding markdown formatting (e.g. **@name**, _@name_, `@name`).
 */
export function extractMentionNames(text: string): string[] {
  const matches = text.match(/@(\S+)/g);
  if (!matches) return [];
  const names = new Set<string>();
  for (const m of matches) {
    // Strip the leading '@', then remove surrounding markdown chars (* _ ` ~)
    const raw = m.slice(1).toLowerCase();
    const cleaned = raw.replace(/^[*_`~]+|[*_`~.,;:!?)]+$/g, '');
    if (cleaned) names.add(cleaned);
  }
  return Array.from(names);
}

export function createExecutionLog(
  from: string,
  event: ExecutionLogEvent,
  summary: string,
  options?: {
    level?: ExecutionLogLevel;
    durationMs?: number;
    sourceMessageId?: string;
    metadata?: Record<string, unknown>;
  },
): SkynetMessage {
  const payload: ExecutionLogPayload = {
    event,
    summary,
    level: options?.level ?? 'info',
    ...(options?.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options?.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
  };
  return createMessage({
    type: MessageType.EXECUTION_LOG,
    from,
    payload,
  });
}

export function serialize(msg: SkynetMessage): string {
  return JSON.stringify(msg);
}

export function deserialize(raw: string): SkynetMessage {
  return JSON.parse(raw) as SkynetMessage;
}
