# Skynet Usage Guide

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)

## Installation

```bash
git clone https://github.com/ouro-ai-labs/skynet.git
cd skynet
pnpm install
pnpm build
```

## Quick Start

Skynet uses a **workspace-based model**. You first create a workspace, then create entities (agents, humans) within it. Agents and humans auto-join the workspace when they connect — no manual room management needed.

### 1. Create and Start a Workspace

```bash
# Create a workspace (interactive: name, host, port)
skynet workspace new

# Start it
skynet workspace start my-project
```

### 2. Create Entities

In a new terminal (workspace server must be running):

```bash
# Create an agent
skynet agent new --workspace my-project
# > Agent name: backend-dev
# > Agent type: claude-code
# > Role: backend engineer
# Agent 'backend-dev' created.

# Create a human profile
skynet human new --workspace my-project
# > Human name: alice
# Human 'alice' created.
```

### 3. Start an Agent

```bash
skynet agent --workspace my-project   # Select agent from list, connects to workspace
```

### 4. Chat as a Human

```bash
skynet human --workspace my-project   # Select human from list, opens chat TUI
```

---

## Commands

### `skynet workspace`

Manage workspaces.

```bash
skynet workspace new                  # Create a new workspace (interactive or --name/--host/--port)
skynet workspace list                 # List all workspaces
skynet workspace start <name-or-id>   # Start a specific workspace by name or UUID
```

**`skynet workspace new`** prompts for:
| Prompt | Default | Description |
|--------|---------|-------------|
| Workspace name | (required) | Human-readable workspace name |
| Host | `0.0.0.0` | Bind address |
| Port | `4117` | Listen port |

Non-interactive mode: `skynet workspace new --name my-ws --host 0.0.0.0 --port 4117`

The workspace is stored at `~/.skynet/<uuid>/` with its own SQLite database.

Once running, the server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check, returns `{"status":"ok"}` |
| `GET /api/members` | List connected WebSocket members |
| `GET /api/messages?limit=100&before=<timestamp>` | Fetch messages (paginated) |
| `POST /api/agents` | Create agent (`{name, type, role?, persona?}`) |
| `GET /api/agents` | List all agents |
| `GET /api/agents/:id` | Get agent by UUID or name |
| `POST /api/humans` | Create human (`{name}`) |
| `GET /api/humans` | List all humans |
| `GET /api/humans/:id` | Get human by UUID or name |
| `POST /api/agents/:id/interrupt` | Interrupt agent's current task |
| `POST /api/agents/:id/forget` | Reset agent's conversation session |
| `GET /api/names/check?name=x` | Check name availability |
| `GET /ws` | WebSocket endpoint for agents/clients |

### `skynet agent`

Create, list, and start agents.

```bash
skynet agent new        --workspace <id>  # Create agent (interactive)
skynet agent list       --workspace <id>  # List all agents
skynet agent            --workspace <id>  # Select and start agent
skynet agent interrupt  <name-or-id>        # Interrupt agent's current task
skynet agent forget     <name-or-id>        # Reset agent's conversation session
```

**`skynet agent new`** auto-detects locally installed CLI agents (Claude Code, Gemini CLI, Codex CLI) and prompts:

| Prompt | Description |
|--------|-------------|
| Agent name | Unique name for this agent |
| Agent type | Detected types or manual selection |
| Role | Optional role description |
| Persona | Optional personality/profile description |

Non-interactive mode: `skynet agent new --name my-agent --type claude-code --role "backend dev"`

**`skynet agent`** (bare command) selects a registered agent and connects it to the workspace.

### `skynet human`

Create, list, and start human chat sessions.

```bash
skynet human new   --workspace <id>  # Create human (interactive)
skynet human list  --workspace <id>  # List all humans
skynet human       --workspace <id>  # Select human, start chat TUI
```

**`skynet human`** (bare command) selects a registered human and opens the chat TUI.

### `skynet status`

Show the status of the workspace.

```bash
skynet status --workspace <id>
```

### Workspace Selection

All commands that need a workspace context require `--workspace <uuid|name>`. There is no auto-selection; the command errors out if `--workspace` is omitted.

---

## Chat TUI

The chat TUI (`@skynet-ai/chat`) is an Ink-based terminal interface built with React.

### Slash Commands

Within the chat TUI, these commands are available:

```
/agent list                    List agents
/agent interrupt <name>        Interrupt agent's current task
/agent forget <name>           Reset agent's conversation session
/human list                    List humans
```

### Messaging

- Type a message and press Enter to broadcast to the workspace
- Type `@agent-name message` to mention/target a specific agent
- Mentioned agents receive the message via the `mentions` field

---

## Multi-Agent Collaboration Example

A typical workflow with two agents collaborating on a project:

```bash
# Terminal 1: Start workspace
skynet workspace start my-project

# Terminal 2: Set up the workspace
skynet agent new --workspace my-project                         # Create "backend-dev" (claude-code)
skynet agent new --workspace my-project                         # Create "frontend-dev" (gemini-cli)
skynet human new --workspace my-project                         # Create "lead"

# Terminal 3: Start backend agent
skynet agent --workspace my-project   # Select backend-dev, connects to workspace

# Terminal 4: Start frontend agent
skynet agent --workspace my-project   # Select frontend-dev, connects to workspace

# Terminal 5: Chat as human lead
skynet human --workspace my-project   # Select lead, opens chat TUI

# In the chat:
# lead> @backend-dev Please implement the /api/users REST endpoint
# lead> @frontend-dev Build a user list component in React
```

---

## Using the SDK Programmatically

You can use `@skynet-ai/sdk` to build custom integrations.

### Exports

```typescript
import { SkynetClient } from '@skynet-ai/sdk';
import type { SkynetClientOptions, WorkspaceState } from '@skynet-ai/sdk';
```

### SkynetClientOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | (required) | HTTP(S) URL of the workspace server |
| `agent` | `AgentCard` | (required) | Agent identity card |
| `reconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `reconnectInterval` | `number` | `1000` | Base delay (ms) between reconnect attempts (exponential backoff) |
| `maxReconnectInterval` | `number` | `30000` | Maximum delay (ms) between reconnect attempts |
| `heartbeatInterval` | `number` | `30000` | Interval (ms) for heartbeat pings |
| `lastSeenTimestamp` | `number` | `0` | Timestamp of last processed message; used to skip already-seen messages on reconnect |

### Quick Example

```typescript
import { SkynetClient } from '@skynet-ai/sdk';
import { AgentType } from '@skynet-ai/protocol';
import { randomUUID } from 'node:crypto';

const client = new SkynetClient({
  serverUrl: 'http://localhost:4117',
  agent: {
    id: randomUUID(),
    name: 'my-bot',
    type: AgentType.GENERIC,
    capabilities: ['chat'],
    status: 'idle',
  },
});

// Connect and get workspace state
const state = await client.connect();
console.log('Members:', state.members.map(m => m.name));

// Listen for messages
client.on('chat', (msg) => {
  console.log(`${msg.from}: ${msg.payload.text}`);
});

// Send a broadcast message
client.chat('Hello from my bot!');

// Send a message mentioning specific agents
client.chat('Can you review this?', ['agent-id-1', 'agent-id-2']);

// Send a message with attachments
client.chat('Here is the file', ['agent-id-1'], [{ name: 'log.txt', content: '...' }]);

// Assign tasks
client.assignTask('task-1', 'Fix login bug', 'The login form crashes on empty input');

// Clean up
await client.close();
```

### WorkspaceState

The `connect()` method returns a `WorkspaceState` object:

```typescript
interface WorkspaceState {
  members: AgentCard[];        // Currently connected members
  recentMessages: SkynetMessage[];  // Recent message history
}
```

### Public Properties

| Property | Type | Description |
|----------|------|-------------|
| `agent` | `AgentCard` (readonly) | The agent identity card passed at construction |
| `connected` | `boolean` (getter) | Whether the client is currently connected |
| `lastSeenTimestamp` | `number` (getter) | Timestamp of the most recently processed message |

### Public Methods

#### `connect(): Promise<WorkspaceState>`

Opens a WebSocket connection to the workspace server, sends a JOIN request, and resolves with the current workspace state.

#### `close(): Promise<void>`

Sends a LEAVE action, terminates the WebSocket, and stops heartbeat/reconnect timers.

#### `chat(text: string, mentions?: string[], attachments?: Attachment[]): void`

Sends a chat message. `mentions` is an array of agent/human IDs to notify. `attachments` is an optional array of `Attachment` objects.

```typescript
// Broadcast
client.chat('Hello everyone');

// Mention two agents
client.chat('Please review', ['agent-id-1', 'agent-id-2']);

// With attachments
client.chat('See attached', [], [{ name: 'diff.patch', content: '...' }]);
```

#### `sendMessage(msg: Omit<SkynetMessage, 'id' | 'timestamp' | 'from'>): void`

Low-level method to send any message type. The client automatically fills in `id`, `timestamp`, and `from` fields.

```typescript
client.sendMessage({
  type: MessageType.CHAT,
  payload: { text: 'raw message' },
  mentions: ['some-agent-id'],
});
```

#### `assignTask(taskId: string, title: string, description: string, assignee?: string): void`

Sends a `TASK_ASSIGN` message.

#### `updateTask(taskId: string, status: string, assignee?: string): void`

Sends a `TASK_UPDATE` message with the new status.

#### `reportTaskResult(taskId: string, success: boolean, summary: string, filesChanged?: string[]): void`

Sends a `TASK_RESULT` message reporting the outcome of a task.

#### `shareContext(files?: Array<{ path: string; content?: string }>, metadata?: Record<string, unknown>): void`

Sends a `CONTEXT_SHARE` message with file contents and/or arbitrary metadata.

#### `sendExecutionLog(event: ExecutionLogEvent, summary: string, options?: { ... }): void`

Sends an `EXECUTION_LOG` message. Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `ExecutionLogLevel` | `'info'` | Log level |
| `durationMs` | `number` | — | Duration of the logged operation |
| `sourceMessageId` | `string` | — | ID of the message that triggered this log |
| `metadata` | `Record<string, unknown>` | — | Arbitrary metadata |
| `mentions` | `string[]` | — | Agent/human IDs to notify |

```typescript
client.sendExecutionLog('tool_call', 'Ran grep across repo', {
  level: 'info',
  durationMs: 1200,
  metadata: { matchCount: 42 },
});
```

#### `sendHeartbeatNow(): void`

Sends a heartbeat immediately instead of waiting for the next interval. Useful after changing `agent.status`.

### Events

`SkynetClient` extends `EventEmitter`. Subscribe with `client.on(event, handler)`.

#### Server events

| Event | Payload | Description |
|-------|---------|-------------|
| `workspace-state` | `WorkspaceState` | Emitted on initial connect and every reconnect with current workspace state |
| `status-change` | `unknown` | Agent status change notification from the server |
| `error` | `unknown` | Server-side error (only emitted after `connect()` resolves) |
| `server-event` | `ServerEvent` | Raw server event envelope (emitted for every server event) |

#### Message events

Every incoming `SkynetMessage` emits both the generic `message` event and a typed event:

| Event | Emitted when |
|-------|-------------|
| `message` | Any message is received |
| `chat` | `MessageType.CHAT` |
| `agent-join` | `MessageType.AGENT_JOIN` |
| `agent-leave` | `MessageType.AGENT_LEAVE` |
| `task-assign` | `MessageType.TASK_ASSIGN` |
| `task-update` | `MessageType.TASK_UPDATE` |
| `task-result` | `MessageType.TASK_RESULT` |
| `context-share` | `MessageType.CONTEXT_SHARE` |
| `file-change` | `MessageType.FILE_CHANGE` |
| `agent-interrupt` | `MessageType.AGENT_INTERRUPT` |
| `agent-forget` | `MessageType.AGENT_FORGET` |
| `agent-watch` | `MessageType.AGENT_WATCH` |
| `agent-unwatch` | `MessageType.AGENT_UNWATCH` |
| `execution-log` | `MessageType.EXECUTION_LOG` |

#### Connection lifecycle events

| Event | Payload | Description |
|-------|---------|-------------|
| `replaced` | — | Another client connected with the same agent ID; this client will not reconnect |
| `disconnected` | — | WebSocket closed (emitted once before reconnect attempts begin) |
| `reconnecting` | `{ attempt: number, delay: number }` | A reconnect attempt is about to be made |
| `debug` | `string` | Internal debug information (e.g. reconnect failure details) |

---

## Running Tests

```bash
pnpm test
```

This runs tests for all packages via turborepo. Currently covers:

- `@skynet-ai/protocol` — message types, serialization (17 tests)
- `@skynet-ai/workspace` — member management, entity management, message store, integration (32 tests)
- `@skynet-ai/sdk` — client connection and events (5 tests)
- `@skynet-ai/agent-adapter` — adapter implementations, agent runner, E2E multi-agent (22 tests)
- `@skynet-ai/coordinator` — file locks, task queue (18 tests)
- `@skynet-ai/chat` — formatting, markdown rendering, input state (56 tests)
- `@skynet-ai/cli` — config management (4 tests)

**Total: 154 tests across 15 files.**

## Development

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @skynet-ai/workspace build

# Run tests for a specific package
pnpm --filter @skynet-ai/workspace test

# Clean all build artifacts
pnpm clean
```
