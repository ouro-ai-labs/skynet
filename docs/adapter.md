# Agent Adapter

`packages/agent-adapter` translates Skynet network messages into CLI agent calls and returns the results back to the network. It is essentially a **CLI process management layer**.

## Architecture

```
AgentAdapter (abstract base class)
├── ClaudeCodeAdapter   — claude CLI (fully implemented)
├── OpenCodeAdapter     — opencode CLI (fully implemented)
├── GeminiCliAdapter    — gemini CLI (stub)
├── CodexCliAdapter     — codex CLI (stub)
└── GenericAdapter      — configurable generic adapter
        ↓
   AgentRunner — connects adapters to the Skynet network (WebSocket)
```

## Abstract Base Class `AgentAdapter`

Defined in `src/base-adapter.ts`. All adapters must implement the following methods:

| Method | Description |
|--------|-------------|
| `isAvailable()` | Check if the corresponding CLI tool is installed locally |
| `handleMessage(msg, senderName?, notices?)` | Convert a `SkynetMessage` to a prompt, call the CLI, return the text response. Optional `notices` string is prepended (e.g. join/leave events) |
| `executeTask(task)` | Execute a standalone task, return a `TaskResult` |
| `supportsQuickReply()` | Whether this adapter supports forked quick replies while busy. Returns `false` by default |
| `quickReply(prompt)` | Quick reply using a forked context. Only called when `supportsQuickReply()` is `true`. Throws by default |
| `interrupt()` | Interrupt the currently running process (returns `true` if a process was killed) |
| `resetSession()` | Reset the conversation session (generates a new session ID, starts fresh) |
| `getSessionState()` | Return serializable `SessionState` for persistence across restarts, or `undefined` if unsupported |
| `restoreSessionState(state)` | Restore session state from a previous run. Called before the first `handleMessage()` |
| `dispose()` | Clean up resources (kill child processes, etc.) |

**Properties and callbacks:**

| Property | Type | Description |
|----------|------|-------------|
| `persona` | `string \| undefined` | System prompt / persona text. Set by `AgentRunner` before calls begin |
| `onPrompt` | `(prompt, context) => void` | Optional callback invoked with the exact prompt text before sending to the CLI. `context.type` is `'message'`, `'task'`, or `'quick-reply'` |
| `onExecutionLog` | `(event, summary, metadata?) => void` | Optional callback invoked when the adapter produces execution log events (tool calls, thinking, etc.) |

`TaskResult` structure:

```ts
interface TaskResult {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}
```

`SessionState` structure:

```ts
interface SessionState {
  sessionId: string;
  sessionStarted: boolean;
}
```

## Concrete Adapters

### ClaudeCodeAdapter

Invokes `claude -p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions`.

**Options (`ClaudeCodeOptions`):**

| Field | Type | Description |
|-------|------|-------------|
| `projectRoot` | `string` | Working directory (required) |
| `allowedTools` | `string[]` | Passed as `--allowedTools` argument |
| `model` | `string` | Specify model via `--model` |

**Timeout**: Uses `timeout: 0` (no timeout) — the agent runs until it finishes naturally.

**Session Persistence**: Session state (`sessionId` + `sessionStarted` flag) is managed via the base class `getSessionState()` / `restoreSessionState()` interface. `AgentRunner` persists this state to a JSON file at `statePath` and restores it on restart. The first call uses `--session-id <id>` to create a named session; subsequent calls use `--resume <id>` to continue the conversation.

**System Prompt Injection**: When `persona` is set (by `AgentRunner`), the adapter passes it via `--append-system-prompt`.

**Image Attachment Support**: When a chat message contains image attachments, the adapter extracts base64-encoded image data, writes each image to a temporary file in the OS temp directory, and appends file path references to the prompt. Temp files are cleaned up after the call completes.

**Stream-JSON Parsing**: The adapter uses `--output-format stream-json` and parses the JSONL output line-by-line. It extracts `result` events for the final response text, and emits `tool.call` / `tool.result` execution log events via the `onExecutionLog` callback. Tool call summaries are formatted with human-readable context (e.g., `Read /path/to/file`, `Bash: git status`).

**Quick Reply (Fork)**: `supportsQuickReply()` returns `true` once a session has been started. Quick replies use `--resume <sessionId> --fork-session` to create a lightweight forked context that does not pollute the main conversation. Image attachments are not supported in quick replies and fall back to the normal queue.

**Error Sanitization**: Execa errors are sanitized to prevent leaking the full command line (which includes `--append-system-prompt` with the entire persona). The adapter prefers execa's `shortMessage` and attaches collected stderr for diagnostics.

### OpenCodeAdapter

Invokes `opencode run <prompt> --format json` in non-interactive mode.

**Options (`OpenCodeOptions`):**

| Field | Type | Description |
|-------|------|-------------|
| `projectRoot` | `string` | Working directory (required) |
| `model` | `string` | Specify model via `--model` (provider/model format, e.g. `anthropic/claude-3-5-sonnet`) |

**Session Management**: Uses `--session <id> --continue` for multi-turn conversations. The first call creates a new session; subsequent calls resume it. Quick replies use `--session <id> --fork` to branch without polluting the main conversation.

**Persona Injection**: When `persona` is set, the adapter prepends it to the prompt text directly (OpenCode does not have a dedicated system prompt flag).

**Output Parsing**: The adapter uses `--format json` and extracts the `content` or `result` field from the JSON response. Falls back to raw text if JSON parsing fails.

**Error Sanitization**: Same approach as ClaudeCodeAdapter — execa errors are sanitized to prevent leaking command-line internals.

### GeminiCliAdapter (Stub)

**Status: Not yet implemented.** `isAvailable()` always returns `false`; `handleMessage()` and `executeTask()` throw `"GeminiCliAdapter is not yet implemented"`. Will be completed once the Claude Code adapter is stable.

**Options**: `projectRoot` only.

### CodexCliAdapter (Stub)

**Status: Not yet implemented.** `isAvailable()` always returns `false`; `handleMessage()` and `executeTask()` throw `"CodexCliAdapter is not yet implemented"`. Will be completed once the Claude Code adapter is stable.

**Options**: `projectRoot` + optional `fullAuto`.

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
| `timeout` | `number` | Timeout in milliseconds (default `0` — no timeout) |

**Persona Injection**: When `persona` is set, the adapter prepends it to the prompt text directly.

## Common Characteristics

- Uses `execa` to spawn child processes with `cwd` set to `projectRoot`
- No default timeout — adapters use `timeout: 0` (let the agent run until done)
- `messageToPrompt()` converts `SkynetMessage` to plain text prompt based on message type (`chat` / `task-assign`)
- Each invocation is an independent child process (no persistent process)
- Error sanitization prevents leaking command-line internals (flags, system prompts) in broadcast messages

## AgentRunner

Defined in `src/agent-runner.ts`. The glue layer that connects adapters to the Skynet network.

**`AgentRunnerOptions` interface:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `serverUrl` | `string` | (required) | WebSocket server URL |
| `adapter` | `AgentAdapter` | (required) | The adapter instance |
| `agentId` | `string` | random UUID | Agent identifier |
| `agentName` | `string` | `<adapter.name>-<uuid8>` | Display name |
| `capabilities` | `string[]` | `['code-edit', 'code-review']` | Agent capabilities |
| `role` | `string` | — | Role description (e.g. "senior engineer") |
| `persona` | `string` | — | Custom persona/system prompt text |
| `projectRoot` | `string` | — | Working directory |
| `statePath` | `string` | — | Path to a JSON file for persisting agent state |
| `logFile` | `string` | — | Log file path for agent logs |
| `debounceMs` | `number` | `3000` | Debounce window for batching chat messages. Set to `0` to disable |

**Responsibilities:**

1. Creates a `SkynetClient` and builds an `AgentCard` (containing agentId, name, capabilities, role, persona, etc.)
2. **Registers the agent via HTTP API** (`ensureRegistered`): checks `GET /api/agents/:id`, and if not found, creates the agent via `POST /api/agents`. Handles 409 (name conflict) by looking up the existing agent and reusing its ID.
3. **Injects persona/system prompt** via `skynet-intro.ts`: combines the role, custom persona, and a standard Skynet identity/messaging-rules intro into `adapter.persona`.
4. Listens for `chat` and `task-assign` events, queuing them for processing
5. **Processes the queue serially** (`processing` lock prevents concurrency)
6. Sets status to `busy` during processing, `idle` when done
7. For task-type messages, sends an `in-progress` status update first, then reports `TaskResult` on completion

**Prompt Logging:**

When `statePath` is set, AgentRunner creates a `prompt.log` file in the same directory. Every prompt sent to the adapter is appended with a timestamp and type (`message`, `task`, or `quick-reply`), enabling post-hoc debugging of agent behavior.

**`<no-reply />` Tag Support:**

If an adapter's response contains the `<no-reply />` XML tag, the entire message is suppressed and not sent to the workspace. This allows agents to signal "I have nothing to add" without generating noise. The `skynet-intro.ts` system prompt teaches agents when and how to use this tag.

**Error Message Sanitization:**

The `sanitizeErrorMessage()` function extracts safe error messages from exceptions. It prefers execa's `shortMessage` (which omits stdout/stderr dumps) and strips `Command failed…: <binary> <args>` prefixes so that adapter internals (flags, system prompts) are never exposed in execution logs broadcast to the workspace.

**Control Events:**

AgentRunner listens for the following control events:

| Event | Behavior |
|-------|----------|
| `agent-interrupt` | Kills the running process, clears the message queue and pending notices, resets processing state to idle |
| `agent-forget` | Resets the adapter session (`resetSession()`), clears the message queue, pending notices, and dedup set, resets processing state to idle |
| `agent-watch` | Adds the human (from `AgentWatchPayload.humanId`) to the set of verbose log subscribers |
| `agent-unwatch` | Removes the human (from `AgentUnwatchPayload.humanId`) from verbose log subscribers |

**Verbose Execution Log Subscribers (`agent-watch` / `agent-unwatch`):**

Humans can subscribe to verbose execution logs via `agent-watch`. When at least one subscriber exists, the `onExecutionLog` callback on the adapter is wired to send `ExecutionLog` messages to the workspace, with `mentions` set to the subscriber list so only watchers receive them. The adapter emits events like `tool.call` and `tool.result` (from Claude Code's stream-json output), and AgentRunner emits `processing.start`, `processing.end`, and `processing.error` events for queue lifecycle. Subscribing mid-execution takes effect immediately (the subscriber set is checked live, not snapshotted).

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

**State Persistence:**

When `statePath` is configured, AgentRunner persists state to a JSON file after each processing cycle. The persisted data includes:

- `lastSeenTimestamp` — the timestamp of the last processed message, used on reconnection to avoid replaying old messages
- `session` — the adapter's `SessionState` (if supported), enabling session resumption across restarts

On startup, the runner loads this file and calls `adapter.restoreSessionState(session)` to resume the previous conversation context.

**Member Name Tracking:**

AgentRunner listens for `agent-join`, `agent-leave`, and `workspace-state` events to maintain a local `memberInfo` map. This map is used to resolve `@name` mentions in outgoing responses to agent IDs, and to display human-readable sender names in prompts.

```ts
const runner = new AgentRunner({
  serverUrl: 'ws://localhost:3000',
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
