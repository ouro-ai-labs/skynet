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

The `mentions` field drives all message routing. Mentioned agents receive the message; agents without a mention do not.

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
  status?: AgentStatus;       // 'idle' | 'busy' | 'offline'
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
- **Task routing**: the coordinator can match tasks to agents based on their strengths
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

## Payload Types

### Chat

```typescript
interface ChatPayload {
  text: string;
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

## Client-Server Wire Protocol

Clients communicate with the server using JSON envelopes over WebSocket.

```typescript
enum ClientAction {
  JOIN = 'join',
  LEAVE = 'leave',
  SEND = 'send',
  HEARTBEAT = 'heartbeat',
  TYPING = 'typing',
}

interface ClientEnvelope {
  action: ClientAction;
  data: unknown;
}

interface JoinRequest {
  agent: AgentCard;
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
| `typing` | When a member starts/stops typing | `{agentId: string, isTyping: boolean}` |
| `error` | On invalid client action | `{message: string}` |

**Note:** The `workspace.state` event is sent on every connection, including reconnections. The SDK emits a `workspace-state` event each time, allowing agents to refresh their local state (e.g., member name maps) after network interruptions.

See [workspace.md](workspace.md) for the full WebSocket protocol details and message flow.
