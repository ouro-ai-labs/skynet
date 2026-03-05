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
}
```

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
