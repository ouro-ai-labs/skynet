# Workspace Server

`packages/server` — WebSocket messaging server handling member management, entity management, message routing, and persistence.

## File Structure

```
packages/server/src/
  server.ts          # SkynetServer — Fastify + WebSocket main server
  member-manager.ts  # MemberManager — In-memory workspace member management
  store.ts           # Store interface
  sqlite-store.ts    # SqliteStore — SQLite message + entity persistence
  index.ts           # Module exports
```

## Core Classes

### SkynetServer (`server.ts`)

Main server entry point, built on Fastify + `@fastify/websocket`.

**Options** (`SkynetServerOptions`):

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `4117` | Listen port |
| `host` | `0.0.0.0` | Listen address |
| `store` | — | `SqliteStore` instance for persistence |

**Internal State**:

- `memberManager: MemberManager` — Workspace member registry
- `store: SqliteStore` — Message + entity persistence
- `socketAgentMap: WeakMap<WebSocket, string>` — Socket-to-agentId mapping; WeakMap prevents memory leaks

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

1. Adds agent to workspace via `MemberManager`
2. Establishes socket-to-agent mapping
3. Returns current member list + last 50 messages to the joining agent
4. Broadcasts `AGENT_JOIN` message to other members
5. Persists the join message

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

```
-> {action: "leave"} or WebSocket close event
```

1. Remove member from workspace
2. Create and persist `AGENT_LEAVE` message
3. Broadcast to remaining members
4. Clean up socket mapping

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
   |                        |-- AGENT_JOIN broadcast ->|
   |                        |                          |
   |-- SEND (broadcast) --->|                          |
   |<-- msg (echo back) ----|-- msg ------------------>|
   |                        |                          |
   |-- SEND (to: B) ------->|                          |
   |<-- msg (confirm) ------|-- msg (point-to-point) ->|
   |                        |                          |
   |        [disconnect]    |                          |
   |                        |-- AGENT_LEAVE broadcast ->|
```

## Design Decisions

1. **WeakMap for socket mapping** — Automatically garbage-collected when socket is closed, no memory leaks
2. **Server overwrites `from`** — Clients cannot spoof sender identity
3. **INSERT OR REPLACE** — Idempotent message writes, no errors on duplicates
4. **Broadcast includes sender** — Sender receives echo of their own message as delivery confirmation
5. **Synchronous SQLite** — better-sqlite3 is synchronous; simple and direct, blocks the event loop but acceptable at current message volumes
6. **Cross-entity name uniqueness** — Agent and human names must be unique within a workspace to avoid ambiguity in @-mentions and CLI commands
7. **No rooms** — Workspaces are naturally isolated; a flat member model is simpler than nested rooms

## Not Yet Implemented

- Authentication / authorization (anyone can connect)
- Message encryption
- Rate limiting
- Server-side reconnection / clustering
