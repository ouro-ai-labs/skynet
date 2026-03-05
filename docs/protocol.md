# Skynet Protocol Design

## Message Envelope

All messages use a unified envelope format:

```typescript
interface SkynetMessage {
  id: string;              // UUID
  type: MessageType;       // See enum below
  from: string;            // Agent ID
  to: string | null;       // null = broadcast to room
  roomId: string;          // Room/project ID
  timestamp: number;
  payload: any;            // Varies by type
  replyTo?: string;        // Reply to a specific message
}
```

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
  agentId: string;
  name: string;               // e.g. "claude-code-1", "human-alice"
  type: AgentType;            // CLAUDE_CODE | GEMINI_CLI | CODEX_CLI | HUMAN | MONITOR
  capabilities: string[];     // ["code-edit", "code-review", "test"]
  projectRoot?: string;
  status: 'idle' | 'busy' | 'offline';
  persona?: string;           // Markdown profile (see below)
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
