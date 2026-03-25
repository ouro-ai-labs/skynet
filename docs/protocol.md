# Skynet Protocol Design

## Message Envelope

All messages use a unified envelope format:

```typescript
interface SkynetMessage {
  id: string;              // UUID
  type: MessageType;       // See enum below
  from: string;            // Agent ID
  timestamp: number;
  payload: unknown;        // Varies by type
  replyTo?: string;        // Reply to a specific message
  mentions?: string[];     // Agent IDs mentioned via @name
}
```

The `mentions` field drives all message routing. Mentioned agents receive the message; agents without a mention do not (humans are an exception — they receive all messages regardless). The final `mentions` array is built from both client-provided values and server-side text scanning. See `docs/workspace.md` [Message Routing](workspace.md#message-routing) for the full enrichment and routing rules.

## Message Types

```typescript
enum MessageType {
  // System messages
  AGENT_JOIN = 'agent.join',
  AGENT_LEAVE = 'agent.leave',
  AGENT_HEARTBEAT = 'agent.heartbeat',

  // Chat / Collaboration
  CHAT = 'chat',                    // Free conversation
  TASK_ASSIGN = 'task.assign',      // Assign a task
  TASK_UPDATE = 'task.update',      // Task status update
  TASK_RESULT = 'task.result',      // Task completion result

  // Context sharing
  CONTEXT_SHARE = 'context.share',  // Share file/project info
  FILE_CHANGE = 'file.change',      // File change notification

  // Agent control
  AGENT_INTERRUPT = 'agent.interrupt',  // Interrupt agent's current task
  AGENT_FORGET = 'agent.forget',        // Reset agent's session
  AGENT_WATCH = 'agent.watch',          // Human subscribes to agent logs
  AGENT_UNWATCH = 'agent.unwatch',      // Human unsubscribes from agent logs

  // Execution logs
  EXECUTION_LOG = 'execution.log',      // Agent execution log entry
}
```

## Agent Card

Agent identity description (similar to A2A's Agent Card):

```typescript
interface AgentCard {
  id: string;                 // UUID
  name: string;               // e.g. "claude-dev-1", "human-alice"
  type: AgentType;            // CLAUDE_CODE | GEMINI_CLI | CODEX_CLI | HUMAN | MONITOR | GENERIC

  // Persistent profile fields (stored in DB)
  role?: string;              // e.g. "backend engineer"
  persona?: string;           // Free-form markdown profile (see below)
  createdAt?: number;

  // Runtime fields (set when connected)
  capabilities?: string[];    // ["code-edit", "code-review", "test"]
  projectRoot?: string;
  status: AgentStatus;        // 'idle' | 'busy' | 'offline' | 'error'
}
```

### Agent Persona

The optional `persona` field is a free-form markdown string that defines the agent's personality and profile. It is injected into the agent's system prompt so other agents (and the server) understand who they are talking to.

Example:

```markdown
# Senior Backend Engineer - "Alex"

## Personality
- Pragmatic and detail-oriented
- Prefers simple solutions over clever ones
- Communicates concisely

## Strengths
- Go, Rust, TypeScript
- Database design and optimization
- API architecture and system design
- Performance profiling

## Weaknesses
- Not great at CSS / frontend styling
- Tends to over-engineer error handling

## Work Style
- Likes to read existing code before making changes
- Always writes tests alongside implementation
- Prefers small, focused PRs
```

The persona is used for:
- **Task routing**: the scheduler can match tasks to agents based on their strengths
- **Collaboration context**: when agents communicate, they can understand each other's expertise
- **Human readability**: the monitor dashboard displays agent profiles for humans to understand the team composition

## Agent Types

```typescript
enum AgentType {
  CLAUDE_CODE = 'claude-code',
  GEMINI_CLI = 'gemini-cli',
  CODEX_CLI = 'codex-cli',
  HUMAN = 'human',
  MONITOR = 'monitor',
  GENERIC = 'generic',
}
```

## Human Profile

```typescript
interface HumanProfile {
  id: string;
  name: string;
  createdAt: number;
}
```

## Attachment Types

```typescript
type AttachmentType = 'image';

interface Attachment {
  type: AttachmentType;
  mimeType: string;
  name: string;
  /** Base64-encoded file data. */
  data: string;
  /** Original file size in bytes. */
  size: number;
}

/** Maximum attachment size in bytes (5 MB). */
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
```

## Payload Types

### Chat

```typescript
interface ChatPayload {
  text: string;
  attachments?: Attachment[];
}
```

### Agent Join / Leave

```typescript
interface AgentJoinPayload {
  agent: AgentCard;
}

interface AgentLeavePayload {
  agentId: string;
  reason?: string;
}
```

### Heartbeat

```typescript
interface AgentHeartbeatPayload {
  agentId: string;
  status: AgentStatus;
}
```

### Task

```typescript
type TaskStatus = 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed';

interface TaskPayload {
  taskId: string;
  title: string;
  description: string;
  assignee?: string;
  status: TaskStatus;
  files?: string[];
  metadata?: Record<string, unknown>;
}

interface TaskResultPayload {
  taskId: string;
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}
```

### Context Sharing

```typescript
interface ContextSharePayload {
  files?: Array<{ path: string; content?: string }>;
  metadata?: Record<string, unknown>;
}

interface FileChangePayload {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  agentId: string;
}
```

### Agent Control

```typescript
interface AgentInterruptPayload {
  agentId: string;
  reason?: string;
}

interface AgentForgetPayload {
  agentId: string;
}

interface AgentWatchPayload {
  agentId: string;
  humanId: string;
}

interface AgentUnwatchPayload {
  agentId: string;
  humanId: string;
}
```

### Execution Log

```typescript
type ExecutionLogLevel = 'info' | 'warn' | 'error' | 'debug';

type ExecutionLogEvent =
  | 'processing.start'
  | 'processing.end'
  | 'processing.error'
  | 'tool.call'
  | 'tool.result'
  | 'thinking'
  | 'custom';

interface ExecutionLogPayload {
  event: ExecutionLogEvent;
  summary: string;
  level: ExecutionLogLevel;
  durationMs?: number;
  sourceMessageId?: string;
  metadata?: Record<string, unknown>;
}
```

## Special Constants

```typescript
/** Special mention ID that targets all workspace members. */
const MENTION_ALL = '__all__';

/** Close code sent when a connection is replaced by another with the same agent ID. */
const WS_CLOSE_REPLACED = 4001;
```

## Client-Server Wire Protocol

Clients communicate with the server using JSON envelopes over WebSocket.

```typescript
enum ClientAction {
  JOIN = 'join',
  LEAVE = 'leave',
  SEND = 'send',
  HEARTBEAT = 'heartbeat',
}

interface ClientEnvelope {
  action: ClientAction;
  data: unknown;
}

interface JoinRequest {
  agent: AgentCard;
  /** Timestamp of the last message the client saw — server will only replay newer messages. */
  lastSeenTimestamp?: number;
}

interface ServerEvent {
  event: string;
  data: unknown;
}
```

### Server Events

The server sends events to clients as JSON: `{event: string, data: unknown}`.

| Event | When | Data |
|-------|------|------|
| `workspace.state` | On every (re)connection | `{members: AgentCard[], recentMessages: SkynetMessage[]}` |
| `heartbeat.ack` | After receiving a heartbeat | `{timestamp: number}` |
| `error` | On invalid client action | `{message: string}` |

**Note:** The `workspace.state` event is sent on every connection, including reconnections. The SDK emits a `workspace-state` event each time, allowing agents to refresh their local state (e.g., member name maps) after network interruptions.

See [workspace.md](workspace.md) for the full WebSocket protocol details and message flow.
