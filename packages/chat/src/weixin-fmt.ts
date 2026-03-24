import {
  type AgentCard,
  type Attachment,
  type ChatPayload,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type TaskPayload,
  type TaskResultPayload,
  type SkynetMessage,
  AgentType,
  MessageType,
} from '@skynet-ai/protocol';
import { type AgentResolver, createAgentResolver } from './format.js';

export { createAgentResolver };

/**
 * Format a timestamp as HH:MM for WeChat display.
 */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export interface FormatOptions {
  /** When true, strip sender/target prefix from chat messages (1:1 mode). */
  compact?: boolean;
}

/**
 * Format a SkynetMessage as plain text for WeChat (no ANSI, no Unicode markers).
 * Returns null for message types that should be suppressed (e.g. execution logs).
 */
export function formatForWeixin(msg: SkynetMessage, resolve: AgentResolver, opts?: FormatOptions): string | null {
  const compact = opts?.compact ?? false;
  switch (msg.type) {
    case MessageType.CHAT:
      return formatChat(msg, resolve, compact);
    case MessageType.TASK_ASSIGN:
      return formatTaskAssign(msg, resolve);
    case MessageType.TASK_RESULT:
      return formatTaskResult(msg, resolve);
    case MessageType.AGENT_JOIN:
      return formatJoin(msg);
    case MessageType.AGENT_LEAVE:
      return formatLeave(msg, resolve);
    case MessageType.EXECUTION_LOG:
      return null; // Suppress execution logs in WeChat
    default:
      return null;
  }
}

/**
 * Check if the workspace is in 1:1 mode (exactly 1 agent + 1 human).
 */
export function isOneOnOne(members: Map<string, AgentCard>): boolean {
  let agents = 0;
  let humans = 0;
  for (const m of members.values()) {
    if (m.type === AgentType.HUMAN) humans++;
    else agents++;
  }
  return agents === 1 && humans === 1;
}

function formatChat(msg: SkynetMessage, resolve: AgentResolver, compact: boolean): string {
  const p = msg.payload as ChatPayload;
  const attachmentLines = formatAttachments(p.attachments);

  // In 1:1 mode, just return the message text without any prefix
  if (compact) {
    const parts = [p.text, attachmentLines].filter(Boolean);
    return parts.join('\n');
  }

  const sender = resolve(msg.from);
  const targets: string[] = [];
  if (msg.mentions && msg.mentions.length > 0) {
    for (const mid of msg.mentions) {
      if (mid === '__all__') {
        targets.push('@all');
      } else {
        targets.push(`@${resolve(mid).name}`);
      }
    }
  }
  const arrow = targets.length > 0 ? ` -> ${targets.join(', ')}` : '';
  const body = [p.text, attachmentLines].filter(Boolean).join('\n');
  return `[${sender.name}]${arrow}\n${body}`;
}

function formatAttachments(attachments?: Attachment[]): string {
  if (!attachments || attachments.length === 0) return '';
  return attachments.map((att) => `[${att.name} ${formatSize(att.size)}]`).join('\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTaskAssign(msg: SkynetMessage, resolve: AgentResolver): string {
  const sender = resolve(msg.from);
  const p = msg.payload as TaskPayload;
  const assignee = p.assignee ? ` -> ${resolve(p.assignee).name}` : '';
  return `[${sender.name}] Task: "${p.title}"${assignee}`;
}

function formatTaskResult(msg: SkynetMessage, resolve: AgentResolver): string {
  const sender = resolve(msg.from);
  const p = msg.payload as TaskResultPayload;
  const icon = p.success ? 'OK' : 'FAIL';
  return `[${sender.name}] Result [${icon}]: ${p.summary}`;
}

function formatJoin(msg: SkynetMessage): string {
  const p = msg.payload as AgentJoinPayload;
  return `[System] ${p.agent.name} joined`;
}

function formatLeave(msg: SkynetMessage, resolve: AgentResolver): string {
  const p = msg.payload as AgentLeavePayload;
  const agent = resolve(p.agentId);
  return `[System] ${agent.name} left`;
}

/**
 * Split a long message into chunks that fit within WeChat's message size limit.
 * Splits at paragraph boundaries (double newline) when possible.
 */
export function chunkMessage(text: string, maxLen = 2048): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at a paragraph boundary
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx <= 0) {
      // Fall back to single newline
      splitIdx = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIdx <= 0) {
      // Fall back to hard split
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
