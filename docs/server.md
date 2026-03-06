# Server Implementation

`packages/server` — WebSocket messaging server handling room management, entity management, message routing, and persistence.

## File Structure

```
packages/server/src/
  server.ts        # SkynetServer — Fastify + WebSocket main server
  room.ts          # Room / RoomManager — In-memory room and member management
  store.ts         # MessageStore interface
  sqlite-store.ts  # SqliteStore — SQLite message + entity persistence
  index.ts         # Module exports
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

- `rooms: RoomManager` — Room registry
- `store: SqliteStore` — Message + entity persistence
- `socketAgentMap: WeakMap<WebSocket, {agentId, roomId}>` — Socket-to-agent mapping; WeakMap prevents memory leaks

**Lifecycle**: `start()` boots the server, `stop()` shuts down server + database.

### Room / RoomManager (`room.ts`)

**Room** — A single collaboration space:

- `members: Map<agentId, RoomMember>` — Member table (AgentCard + WebSocket)
- `join(agent, socket)` — Add member to room
- `leave(agentId)` — Remove member from room
- `broadcast(msg, excludeAgentId?)` — Send to all members (optionally excluding sender)
- `sendTo(agentId, msg)` — Point-to-point delivery
- `updateStatus(agentId, status)` — Update agent status via heartbeat

Checks `socket.readyState === OPEN` before sending to avoid writing to closed sockets.

**RoomManager** — Room registry:

- `getOrCreate(roomId)` — Used on WebSocket JOIN, auto-creates if missing
- `create(roomId)` — Explicit creation via HTTP API, returns null if already exists
- `remove(roomId)` — Closes all member sockets before deletion
- `removeIfEmpty(roomId)` — Auto-cleanup after agent leaves
- `listRooms()` — Returns `{id, memberCount}[]`

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
  room_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,    -- JSON serialized
  reply_to TEXT
);
CREATE INDEX idx_messages_room ON messages(room_id, timestamp);
CREATE INDEX idx_messages_from ON messages("from");

-- Rooms
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

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

-- Room memberships
CREATE TABLE room_members (
  room_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_type TEXT NOT NULL,  -- 'agent' or 'human'
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, member_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
```

**Message Methods**:

- `save(msg)` — INSERT OR REPLACE, idempotent writes
- `getByRoom(roomId, limit, before?)` — Paginated query by room, fetched DESC then reversed to chronological order
- `getById(id)` — Direct lookup by message ID

**Entity Methods**:

- `createRoom(id, name)` / `listRooms()` / `deleteRoom(id)`
- `createAgent(agent)` / `listAgents()` / `getAgent(idOrName)`
- `createHuman(human)` / `listHumans()` / `getHuman(idOrName)`
- `addRoomMember(roomId, memberId, memberType)` / `removeRoomMember(roomId, memberId)`
- `getRoomMembers(roomId)` — Returns registered room memberships
- `checkNameUnique(name)` — Cross-entity name uniqueness check

## WebSocket Protocol

Clients send JSON envelopes: `{action: string, data: unknown}`

### JOIN

```
-> {action: "join", data: {roomId, agent: AgentCard}}
<- {event: "room.state", data: {roomId, members: AgentCard[], recentMessages: SkynetMessage[]}}
```

1. `getOrCreate` retrieves or creates the room
2. Adds agent to room, establishes socket-to-agent mapping
3. Returns current member list + last 50 messages to the joining agent
4. Broadcasts `AGENT_JOIN` message to other members
5. Persists the join message

### SEND

```
-> {action: "send", data: SkynetMessage}
```

- Server overwrites `from` and `roomId` via `createMessage()` to prevent spoofing
- Persists the message
- If `msg.to` is set: point-to-point delivery + echo back to sender as confirmation
- If `msg.to` is null: broadcast to all members (including sender)

### HEARTBEAT

```
-> {action: "heartbeat", data: {agentId, status}}
<- {event: "heartbeat.ack", data: {timestamp}}
```

Updates the agent's status in the room (idle / busy / offline).

### LEAVE / Disconnect

```
-> {action: "leave"} or WebSocket close event
```

1. Remove member from room
2. Create and persist `AGENT_LEAVE` message
3. Broadcast to remaining members
4. Clean up socket mapping
5. Auto-delete room if empty

## HTTP API

### Messages & Rooms (WebSocket)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check, returns room list |
| GET | `/api/rooms` | List all rooms |
| GET | `/api/rooms/:roomId/members` | Get connected WebSocket members |
| GET | `/api/rooms/:roomId/messages` | Query messages (`?limit=100&before=timestamp`) |
| GET | `/api/rooms/:roomId/registered-members` | Get DB-registered room members |
| POST | `/api/rooms` | Create room (body: `{name}`, 409 if name taken) |
| DELETE | `/api/rooms/:roomId` | Destroy room (closes all sockets first, 404 if not found) |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents` | Create agent (body: `{name, type, role?, persona?}`) |
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Get agent by UUID or name |
| POST | `/api/agents/:id/join/:roomId` | Agent joins room |
| POST | `/api/agents/:id/leave/:roomId` | Agent leaves room |

### Humans

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/humans` | Create human (body: `{name}`) |
| GET | `/api/humans` | List all humans |
| GET | `/api/humans/:id` | Get human by UUID or name |
| POST | `/api/humans/:id/join/:roomId` | Human joins room |
| POST | `/api/humans/:id/leave/:roomId` | Human leaves room |

### Names

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/names/check?name=x` | Check name availability across all entity types |

Room IDs in join/leave endpoints accept either UUID or name.

## Message Flow

```
Client A                  Server                    Client B
   |                        |                          |
   |-- JOIN --------------->|                          |
   |<-- room.state ---------|                          |
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
   |                        |-- [removeIfEmpty] -------|
```

## Design Decisions

1. **WeakMap for socket mapping** — Automatically garbage-collected when socket is closed, no memory leaks
2. **Server overwrites from/roomId** — Clients cannot spoof sender identity
3. **INSERT OR REPLACE** — Idempotent message writes, no errors on duplicates
4. **Broadcast includes sender** — Sender receives echo of their own message as delivery confirmation
5. **Synchronous SQLite** — better-sqlite3 is synchronous; simple and direct, blocks the event loop but acceptable at current message volumes
6. **Cross-entity name uniqueness** — Room, agent, and human names must be unique within a workspace to avoid ambiguity in @-mentions and CLI commands

## Not Yet Implemented

- Authentication / authorization (anyone can connect to any room)
- Message encryption
- Rate limiting
- Server-side reconnection / clustering
