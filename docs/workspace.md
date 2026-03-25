# Workspace Server

`packages/workspace` — WebSocket messaging server handling member management, entity management, message routing, and persistence.

## File Structure

```
packages/workspace/src/
  server.ts          # SkynetWorkspace — Fastify + WebSocket main server
  member-manager.ts  # MemberManager — In-memory workspace member management
  scheduler.ts       # Scheduler — Cron-based recurring task scheduler
  store.ts           # Store interface
  sqlite-store.ts    # SqliteStore — SQLite message + entity + schedule persistence
  index.ts           # Module exports
```

## Core Classes

### SkynetWorkspace (`server.ts`)

Main server entry point, built on Fastify + `@fastify/websocket`.

**Options** (`SkynetWorkspaceOptions`):

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `4117` | Listen port |
| `host` | `0.0.0.0` | Listen address |
| `store` | — | `SqliteStore` instance for persistence |
| `disconnectGraceMs` | `300000` (5 min) | Grace period before broadcasting `AGENT_LEAVE` after socket close |
| `recentMentionsLimit` | `3` | Max number of recent mentioned/DM messages for agents in `workspace.state`. Humans always receive up to 100 |
| `logFile` | — | Log file path. When set, server logs are written to this file |

**Internal State**:

- `memberManager: MemberManager` — Workspace member registry
- `store: SqliteStore` — Message + entity persistence
- `socketAgentMap: WeakMap<WebSocket, string>` — Socket-to-agentId mapping; WeakMap prevents memory leaks
- `pendingLeaves: Map<string, Timer>` — Deferred leave timers, cancelled if agent reconnects within grace period

**Lifecycle**: `start()` boots the server, `stop()` shuts down server + database.

### MemberManager (`member-manager.ts`)

Workspace-level member tracking:

- `members: Map<agentId, ConnectedMember>` — Member table (AgentCard + WebSocket)
- `join(agent, socket)` — Add member to workspace
- `leave(agentId)` — Remove member from workspace
- `getMembers()` — Get all connected agent cards
- `broadcast(msg, excludeAgentId?)` — Send to all members (optionally excluding sender)
- `sendTo(agentId, msg)` — Point-to-point delivery
- `updateStatus(agentId, status)` — Update agent status via heartbeat

Checks `socket.readyState === OPEN` before sending to avoid writing to closed sockets.

### SqliteStore (`sqlite-store.ts`)

Synchronous SQLite storage using `better-sqlite3`. Handles both message persistence and entity management.

**Schema**:

```sql
-- Messages
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  "from" TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,    -- JSON serialized
  reply_to TEXT,
  mentions TEXT             -- JSON array
);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_from ON messages("from");
CREATE INDEX idx_messages_type ON messages(type);

-- Agents
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  role TEXT,
  persona TEXT,
  created_at INTEGER NOT NULL
);

-- Humans
CREATE TABLE humans (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
```

**Message Methods**:

- `save(msg)` — INSERT OR REPLACE, idempotent writes
- `getMessages(limit, before?, after?)` — Paginated query, fetched DESC then reversed to chronological order. Optional `after` timestamp filters messages newer than the given value
- `getById(id)` — Direct lookup by message ID
- `getMessagesFor(agentId, limit?, since?)` — Get recent messages where `mentions` includes `agentId` (or `@all`). Optional `since` timestamp for incremental sync. Default limit: 3
- `getExecutionLogs(agentId?, limit?)` — Get execution log messages, optionally filtered by agent ID. Default limit: 50

**Entity Methods**:

- `saveAgent(agent)` / `listAgents()` / `getAgent(idOrName)` / `deleteAgent(id)`
- `saveHuman(human)` / `listHumans()` / `getHuman(idOrName)` / `deleteHuman(id)`
- `checkNameUnique(name)` — Cross-entity name uniqueness check

## WebSocket Protocol

Clients send JSON envelopes: `{action: string, data: unknown}`

### JOIN

```
-> {action: "join", data: {agent: AgentCard, lastSeenTimestamp?: number}}
<- {event: "workspace.state", data: {members: AgentCard[], recentMessages: SkynetMessage[]}}
```

1. Detects reconnection: checks for pending leave timer or existing member with same agent ID
2. If reconnecting: cancels pending leave timer, closes stale socket if still open
3. Adds/updates agent in workspace via `MemberManager`
4. Establishes socket-to-agent mapping
5. Returns current member list + recent messages to the (re)connecting agent. If `lastSeenTimestamp` is provided, only messages after that timestamp are returned (incremental sync). Humans receive up to 100 messages (all types); non-human agents receive only messages mentioning them, limited to `recentMentionsLimit` (default 3)
6. **Only for new members**: broadcasts `AGENT_JOIN` message and persists it. Reconnections are silent — no duplicate join/leave events are broadcast

### SEND

```
-> {action: "send", data: SkynetMessage}
```

- Server overwrites `from` via `createMessage()` to prevent spoofing
- Persists the message
- Routing is entirely **mention-driven** (see [Message Routing](#message-routing) below for full details)

### HEARTBEAT

```
-> {action: "heartbeat", data: {agentId, status}}
<- {event: "heartbeat.ack", data: {timestamp}}
```

Updates the agent's status in the workspace (idle / busy / offline).

When the status actually changes (differs from the previous value), the server broadcasts a `status-change` event to all other connected members (excluding the agent itself):

```
-> (broadcast) {event: "status-change", data: {agentId, status}}
```

This allows UIs to show real-time status indicators (e.g., "thinking...").

### LEAVE / Disconnect

There are two disconnect paths:

**Explicit LEAVE** (`{action: "leave"}`):
- Immediate departure, no grace period
- Member is removed, `AGENT_LEAVE` is broadcast and persisted right away

**Socket close** (network drop, process crash):
- Deferred departure with configurable grace period (`disconnectGraceMs`, default 5 minutes)
- A pending leave timer starts; if the agent reconnects within the grace period, the timer is cancelled and no `AGENT_LEAVE` is broadcast
- If the grace period expires without reconnection, the leave is committed: member is removed, `AGENT_LEAVE` is broadcast and persisted
- During server shutdown (`stop()`), all pending leave timers are cancelled and no further leave processing occurs

## HTTP API

### Health & Status

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check, returns `{"status":"ok","memberCount":N}` |

### Members & Messages

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/members` | Get connected WebSocket members |
| GET | `/api/messages` | Query messages (`?limit=100&before=timestamp`) |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents` | Create agent (body: `{name, type, role?, persona?}`) |
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Get agent by UUID or name |
| DELETE | `/api/agents/:id` | Delete agent by UUID (404 if not found, 409 if connected) |
| POST | `/api/agents/:id/interrupt` | Interrupt agent's current task (body: `{reason?}`) |
| POST | `/api/agents/:id/forget` | Reset agent's conversation session |
| POST | `/api/agents/:id/watch` | Enable execution log streaming to a human (body: `{humanId}`) |
| POST | `/api/agents/:id/unwatch` | Disable execution log streaming (body: `{humanId}`) |

### Humans

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/humans` | Create human (body: `{name}`) |
| GET | `/api/humans` | List all humans |
| GET | `/api/humans/:id` | Get human by UUID or name |
| DELETE | `/api/humans/:id` | Delete human by UUID (404 if not found, 409 if connected) |

### Names

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/names/check?name=x` | Check name availability across all entity types |

## Message Flow

```
Client A                  Server                    Client B
   |                        |                          |
   |-- JOIN --------------->|                          |
   |<-- workspace.state ----|                          |
   |                        |-- AGENT_JOIN broadcast ->|  (new member only)
   |                        |                          |
   |-- SEND (broadcast) --->|                          |
   |<-- msg (echo back) ----|-- msg ------------------>|
   |                        |                          |
   |-- SEND (to: B) ------->|                          |
   |<-- msg (confirm) ------|-- msg (point-to-point) ->|
   |                        |                          |
   |    [socket close]      |                          |
   |                        |  (grace period starts)   |
   |                        |                          |
   |-- JOIN (reconnect) --->|                          |  (silent, no broadcast)
   |<-- workspace.state ----|                          |
   |                        |                          |
   |-- LEAVE -------------->|                          |
   |                        |-- AGENT_LEAVE broadcast ->|  (immediate)
```

## Message Routing

All message delivery is driven by the `mentions` array on `SkynetMessage`. The system builds the final mentions list through two layers, then routes based on the result.

### 1. Mention Resolution (Server-Side Enrichment)

When a client sends a message, the server runs `enrichMentions()` before routing. **Note:** enrichment only applies to `CHAT` messages — other message types (e.g., `EXECUTION_LOG`, `AGENT_JOIN`) pass through with their original mentions array unchanged.

1. Starts with the `mentions` array provided by the client (may be empty).
2. Scans the message text for `@name` patterns, matching case-insensitively against all registered agents and humans.
3. Checks for the `@all` keyword → adds `MENTION_ALL` (`__all__`).
4. Merges all discovered IDs into a deduplicated set.

This ensures mentions are resolved even when:
- The client doesn't resolve them (e.g., the chat TUI sends `mentions: undefined` and relies entirely on server enrichment).
- The mentioned member was offline and absent from the client's cached member list.
- The `@name` is wrapped in markdown (e.g., `**@backend**`).

### 2. Client-Side Mention Injection (Agent Reply)

When an agent's `AgentRunner` sends a reply, it **automatically adds the original sender's ID** to the mentions array. This ensures the sender receives the reply even if the agent's response text doesn't contain an explicit `@name`:

| Scenario | Mentions added |
|----------|---------------|
| Single message reply | `[msg.from]` |
| Quick reply (fork) | `[msg.from]` |
| Batch reply (multiple queued messages) | All unique sender IDs from the batch |

The server then further enriches these with any additional `@name` patterns found in the response text.

> **Note:** This conflates two semantics in the `mentions` field — explicit "@I'm talking to you" mentions and implicit "route this reply back to sender" mentions. Both appear identically in the `mentions` array and in the UI display (shown as `sender -> target1, target2`).

### 3. Routing Rules

After mention enrichment, the server routes the message:

| Mentions | Delivery |
|----------|----------|
| Contains `MENTION_ALL` (`__all__`) | Broadcast to **all** connected members (including sender) |
| Contains specific agent IDs | Deliver to each mentioned member + echo to sender |
| Empty | Echo to sender only |

**Special rules:**
- **Humans always receive all messages** (via `sendToHumans()`), regardless of whether they are mentioned. This gives humans full visibility as observers.
- **Exception — execution logs** (`MessageType.EXECUTION_LOG`): NOT delivered to humans via `sendToHumans()`. Humans only see execution logs for agents they are explicitly watching (via `/watch @agent`).

### 4. Message History on Join

When an agent connects (or reconnects), the server sends recent message history as part of the `workspace.state` response. The history scope differs by member type:

| Member type | History |
|-------------|---------|
| Human | Last 100 messages (all types) |
| Non-human agent | Only recent messages that mention this agent (or `@all`), limited to `recentMentionsLimit` (default 3) |

This prevents agents from seeing conversations they were not part of, while giving humans the full picture.

### 5. End-to-End Example

```
Human "pm" types:  @frontend please start your tasks
                    ↓
Chat TUI sends:     client.chat("@frontend please start your tasks")
                    mentions: undefined (TUI doesn't resolve)
                    ↓
Server enrichMentions():
                    scans text → finds "@frontend" → resolves to frontend's ID
                    final mentions: [frontend-id]
                    ↓
Server routes:      → frontend (mentioned)
                    → pm echo (sender)
                    → all humans (observer rule)
                    ↓
Frontend's AgentRunner processes message, generates response
                    ↓
AgentRunner sends:  client.chat(response, [msg.from])
                    mentions: [pm-id]  (auto-added original sender)
                    ↓
Server enrichMentions():
                    merges client mentions + any @names in text
                    ↓
Server routes:      → pm (mentioned via auto-reply)
                    → all humans (observer rule)
```

Display in chat TUI:
```
⏺ pm -> frontend (14:37)
  ⎿  @frontend please start your tasks

⏺ frontend -> pm (14:38)
  ⎿  Got it, starting now.
```

## Design Decisions

1. **WeakMap for socket mapping** — Automatically garbage-collected when socket is closed, no memory leaks
2. **Server overwrites `from`** — Clients cannot spoof sender identity
3. **INSERT OR REPLACE** — Idempotent message writes, no errors on duplicates
4. **Broadcast includes sender** — Sender receives echo of their own message as delivery confirmation
5. **Synchronous SQLite** — better-sqlite3 is synchronous; simple and direct, blocks the event loop but acceptable at current message volumes
6. **Cross-entity name uniqueness** — Agent and human names must be unique within a workspace to avoid ambiguity in @-mentions and CLI commands
7. **No rooms** — Workspaces are naturally isolated; a flat member model is simpler than nested rooms
8. **Disconnect grace period** — Network flapping (brief disconnects from WiFi changes, process restarts, etc.) should not spam join/leave events. A 5-minute default grace period allows agents to reconnect silently without other members noticing the interruption
9. **Explicit LEAVE vs socket close** — Intentional departures (`LEAVE` action) bypass the grace period for immediate removal. Unintentional disconnects (socket close) use the grace period to allow reconnection
10. **Silent reconnection** — When an agent reconnects within the grace period, the server sends `workspace.state` to the reconnecting agent but does not broadcast `AGENT_JOIN` to others, preventing duplicate join/leave noise

## Not Yet Implemented

- Authentication / authorization (anyone can connect)
- Message encryption
- Rate limiting
- Server-side reconnection / clustering
