// ── Agent Types ──

export enum AgentType {
  CLAUDE_CODE = 'claude-code',
  GEMINI_CLI = 'gemini-cli',
  CODEX_CLI = 'codex-cli',
  HUMAN = 'human',
  MONITOR = 'monitor',
  GENERIC = 'generic',
}

export type AgentStatus = 'idle' | 'busy' | 'offline';

export interface AgentCard {
  id: string;
  name: string;
  type: AgentType;

  // Persistent profile fields (stored in DB)
  role?: string;
  /** Free-form markdown profile: personality, strengths, work style, etc. */
  persona?: string;
  createdAt?: number;

  // Runtime fields (set when connected)
  capabilities?: string[];
  projectRoot?: string;
  status?: AgentStatus;
}

export interface HumanProfile {
  id: string;
  name: string;
  createdAt: number;
}

// ── Message Types ──

export enum MessageType {
  // System
  AGENT_JOIN = 'agent.join',
  AGENT_LEAVE = 'agent.leave',
  AGENT_HEARTBEAT = 'agent.heartbeat',

  // Chat / Collaboration
  CHAT = 'chat',
  TASK_ASSIGN = 'task.assign',
  TASK_UPDATE = 'task.update',
  TASK_RESULT = 'task.result',

  // Context sharing
  CONTEXT_SHARE = 'context.share',
  FILE_CHANGE = 'file.change',
}

export interface SkynetMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string | null;
  timestamp: number;
  payload: unknown;
  replyTo?: string;
  /** Agent IDs additionally mentioned via @name — they receive the message even if not the primary `to` target. */
  mentions?: string[];
}

// ── Payload Types ──

export interface ChatPayload {
  text: string;
}

export interface AgentJoinPayload {
  agent: AgentCard;
}

export interface AgentLeavePayload {
  agentId: string;
  reason?: string;
}

export interface AgentHeartbeatPayload {
  agentId: string;
  status: AgentStatus;
}

export type TaskStatus = 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed';

export interface TaskPayload {
  taskId: string;
  title: string;
  description: string;
  assignee?: string;
  status: TaskStatus;
  files?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskResultPayload {
  taskId: string;
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}

export interface ContextSharePayload {
  files?: Array<{ path: string; content?: string }>;
  metadata?: Record<string, unknown>;
}

export interface FileChangePayload {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  agentId: string;
}

// ── Client-Server Wire Protocol ──

export enum ClientAction {
  JOIN = 'join',
  LEAVE = 'leave',
  SEND = 'send',
  HEARTBEAT = 'heartbeat',
}

export interface ClientEnvelope {
  action: ClientAction;
  data: unknown;
}

export interface JoinRequest {
  agent: AgentCard;
  /** Timestamp of the last message the client saw — server will only replay newer messages. */
  lastSeenTimestamp?: number;
}

export interface ServerEvent {
  event: string;
  data: unknown;
}
