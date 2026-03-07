# Workspace Server

`packages/workspace` — WebSocket messaging server handling member management, entity management, message routing, and persistence.

## File Structure

```
packages/workspace/src/
  server.ts          # SkynetWorkspace — Fastify + WebSocket main server
  member-manager.ts  # MemberManager — In-memory workspace member management
  store.ts           # Store interface
  sqlite-store.ts    # SqliteStore — SQLite message + entity persistence
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
  "to" TEXT,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,    -- JSON serialized
  reply_to TEXT,
  mentions TEXT             -- JSON array
);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_from ON messages("from");

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
- `getMessages(limit, before?)` — Paginated query, fetched DESC then reversed to chronological order
- `getById(id)` — Direct lookup by message ID

**Entity Methods**:

- `saveAgent(agent)` / `listAgents()` / `getAgent(idOrName)`
- `saveHuman(human)` / `listHumans()` / `getHuman(idOrName)`
- `checkNameUnique(name)` — Cross-entity name uniqueness check

## WebSocket Protocol

Clients send JSON envelopes: `{action: string, data: unknown}`

### JOIN

```
-> {action: "join", data: {agent: AgentCard}}
<- {event: "workspace.state", data: {members: AgentCard[], recentMessages: SkynetMessage[]}}
```

1. Detects reconnection: checks for pending leave timer or existing member with same agent ID
2. If reconnecting: cancels pending leave timer, closes stale socket if still open
3. Adds/updates agent in workspace via `MemberManager`
4. Establishes socket-to-agent mapping
5. Returns current member list + last 50 messages to the (re)connecting agent
6. **Only for new members**: broadcasts `AGENT_JOIN` message and persists it. Reconnections are silent — no duplicate join/leave events are broadcast

### SEND

```
-> {action: "send", data: SkynetMessage}
```

- Server overwrites `from` via `createMessage()` to prevent spoofing
- Persists the message
- If `msg.to` is set: point-to-point delivery + echo back to sender as confirmation
- If `msg.to` is null: broadcast to all members (including sender)

### HEARTBEAT

```
-> {action: "heartbeat", data: {agentId, status}}
<- {event: "heartbeat.ack", data: {timestamp}}
```

Updates the agent's status in the workspace (idle / busy / offline).

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
| GET | `/health` | Health check, returns `{"status":"ok"}` |

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

### Humans

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/humans` | Create human (body: `{name}`) |
| GET | `/api/humans` | List all humans |
| GET | `/api/humans/:id` | Get human by UUID or name |

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
