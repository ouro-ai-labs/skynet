# Agent Adapter

`packages/agent-adapter` translates Skynet network messages into CLI agent calls and returns the results back to the network. It is essentially a **CLI process management layer**.

## Architecture

```
AgentAdapter (abstract base class)
├── ClaudeCodeAdapter   — claude CLI
├── GeminiCliAdapter    — gemini CLI
├── CodexCliAdapter     — codex CLI
└── GenericAdapter      — configurable generic adapter
        ↓
   AgentRunner — connects adapters to the Skynet network (WebSocket)
```

## Abstract Base Class `AgentAdapter`

Defined in `src/base-adapter.ts`. All adapters must implement the following methods:

| Method | Description |
|--------|-------------|
| `isAvailable()` | Check if the corresponding CLI tool is installed locally |
| `handleMessage(msg)` | Convert a `SkynetMessage` to a prompt, call the CLI, return the text response |
| `executeTask(task)` | Execute a standalone task, return a `TaskResult` |
| `setRoomId(roomId)` | Associate with a room (used for session persistence). No-op by default |
| `interrupt()` | Interrupt the currently running process (returns `true` if a process was killed) |
| `resetSession()` | Reset the conversation session (generates a new session ID, starts fresh) |
| `dispose()` | Clean up resources (kill child processes, etc.) |

`TaskResult` structure:

```ts
interface TaskResult {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}
```

## Concrete Adapters

### ClaudeCodeAdapter

Invokes `claude -p <prompt> --output-format text`.

**Options (`ClaudeCodeOptions`):**

| Field | Type | Description |
|-------|------|-------------|
| `projectRoot` | `string` | Working directory (required) |
| `allowedTools` | `string[]` | Passed as `--allowedTools` argument |
| `model` | `string` | Specify model via `--model` |
| `sessionStorePath` | `string` | Session storage path, defaults to `<projectRoot>/.skynet/sessions.json` |

**Session Persistence**: Stores session IDs in a local JSON file keyed by roomId. Subsequent calls for the same room automatically include `--resume <sessionId>`, enabling context continuity across process restarts. Storage format:

```json
{
  "room-abc": "session-id-1",
  "room-def": "session-id-2"
}
```

The session ID is extracted from Claude CLI's stderr via regex (`/session[:\s]+([a-f0-9-]+)/i`).

### GeminiCliAdapter

Invokes via pipe: `echo <prompt> | gemini`.

**Options**: `projectRoot` only. No session reuse.

### CodexCliAdapter

Invokes `codex -q <prompt>`.

**Options**: `projectRoot` + optional `fullAuto` (passes `--full-auto`). No session reuse.

### GenericAdapter

A configurable generic adapter that supports any CLI tool.

**Configuration (`GenericAdapterConfig`):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Adapter name |
| `command` | `string` | CLI command |
| `args` | `string[]` | Additional arguments |
| `promptFlag` | `string` | Prompt argument flag (e.g., `-p`). If unset, uses pipe input |
| `versionCommand` | `string` | Command for availability detection |
| `projectRoot` | `string` | Working directory |
| `shell` | `boolean` | Whether to use shell mode (default `true`) |
| `timeout` | `number` | Timeout in milliseconds (default 300000) |

## Common Characteristics

- Uses `execa` to spawn child processes with `cwd` set to `projectRoot`
- Uniform 5-minute timeout
- `messageToPrompt()` converts `SkynetMessage` to plain text prompt based on message type (`chat` / `task-assign`)
- Each invocation is an independent child process (no persistent process)

## AgentRunner

Defined in `src/agent-runner.ts`. The glue layer that connects adapters to the Skynet network.

**Responsibilities:**
1. Creates a `SkynetClient` and registers an `AgentCard` (containing agentId, name, capabilities, etc.)
2. Calls `adapter.setRoomId(roomId)` to associate the room
3. Listens for `chat` and `task-assign` events, queuing them for processing
4. **Processes the queue serially** (`processing` lock prevents concurrency)
5. Sets status to `busy` during processing, `idle` when done
6. For task-type messages, sends an `in-progress` status update first, then reports `TaskResult` on completion

**Message Deduplication:**

AgentRunner maintains an in-memory `Set` of recently processed message IDs (bounded at 500 entries, FIFO eviction). Messages already in the set are silently dropped. This prevents duplicate handling during network reconnections when the server replays recent messages.

**Fork Behavior (Handling Messages While Busy):**

When the agent is busy processing a message, incoming messages are handled as follows:

- **Chat messages from humans**: if the adapter supports `quickReply()`, a forked reply is dispatched immediately. Maximum **1 concurrent fork** — additional messages are queued.
- **Chat messages from agents**: always queued for later batch processing (avoids duplicate/cascading responses).

This prevents agents from missing urgent human messages while working, without overwhelming the adapter with unlimited forks.

**Batch Processing:**

When the main processing thread finishes and multiple chat messages have accumulated in the queue, they are batched into a single adapter call. The combined prompt format is:

```
You have N unread messages. Please respond to all of them in a single reply:

[sender-1]: message text
[sender-2]: message text
```

Responses automatically include all original senders in the `mentions` array, ensuring each sender receives the reply even if the response text doesn't contain an explicit `@name`. For single messages, `mentions` is `[msg.from]`; for batches, it is the deduplicated set of all sender IDs. See `docs/workspace.md` [Message Routing](workspace.md#message-routing) for the full routing flow.

**Debounce Window:**

AgentRunner uses an age-based debounce mechanism to naturally batch messages that arrive close together. Each message records its arrival time; the queue is only processed once **all** messages have aged at least `debounceMs` (default 3000ms). This prevents ping-pong cascades between agents — when multiple messages arrive in quick succession, they are collected and handled in a single batch rather than triggering individual responses. Task messages bypass the debounce and are processed immediately. Set `debounceMs: 0` to disable.

**Member Name Tracking:**

AgentRunner listens for `agent-join`, `agent-leave`, and `workspace-state` events to maintain a local `memberNames` map. This map is used to resolve `@name` mentions in outgoing responses to agent IDs, and to display human-readable sender names in prompts.

```ts
const runner = new AgentRunner({
  serverUrl: 'ws://localhost:3000',
  roomId: 'my-room',
  adapter: new ClaudeCodeAdapter({ projectRoot: '/path/to/project' }),
  agentName: 'my-claude',
  capabilities: ['code-edit', 'code-review'],
});

const state = await runner.start();
// ... agent is now listening and responding
await runner.stop();
```

## Auto-Discovery

`detect.ts` provides two utility functions:

- **`detectAvailableAgents(projectRoot)`** — Concurrently checks all known CLI agents (Claude Code, Gemini CLI, Codex CLI) for availability, returns a list sorted by availability
- **`createAdapter(type, projectRoot)`** — Factory method that creates the corresponding adapter instance based on the `AgentType` enum
