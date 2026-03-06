# Skynet Entity Model

## Overview

Skynet uses a hierarchical entity model: **Workspace/Server > Room, Agent, Human**. Each workspace is an isolated unit with its own database, configuration, and entities.

## Entity Types

### Workspace/Server

The top-level isolation unit. Each workspace has:
- A UUID identifier
- A human-readable name
- Host and port configuration
- Its own SQLite database (`data.db`)
- Agent directories with profiles and work dirs

### Room

A communication channel within a workspace.
- UUID + unique name (auto-generated UUID, user-provided name)
- Members (agents and humans) join/leave rooms
- Messages are scoped to rooms

### Agent

An AI agent instance within a workspace.
- UUID + unique name
- Type: `claude-code`, `gemini-cli`, `codex-cli`, `generic`
- Optional role and persona description
- Can join multiple rooms
- Has a local work directory and profile

### Human

A human participant within a workspace.
- UUID + unique name
- Can join multiple rooms
- Interacts via the chat TUI

## Name Uniqueness

Names are unique **per workspace** across all entity types. A room, agent, and human cannot share the same name within a workspace. This is enforced at the application level via `checkNameUnique()`.

## Directory Structure

```
~/.skynet/
  servers.json                    # Registry: [{id, name, host, port}]
  {workspace_uuid}/
    config.json                   # {host, port}
    data.db                       # SQLite: messages, rooms, agents, humans, room_members
    {agent_uuid}/
      profile.md                  # Agent name, type, role, persona
      work/                       # Agent working directory
```

## Database Schema

### rooms
| Column     | Type    | Constraints          |
|------------|---------|----------------------|
| id         | TEXT    | PRIMARY KEY          |
| name       | TEXT    | UNIQUE NOT NULL      |
| created_at | INTEGER | NOT NULL             |

### agents
| Column     | Type    | Constraints          |
|------------|---------|----------------------|
| id         | TEXT    | PRIMARY KEY          |
| name       | TEXT    | UNIQUE NOT NULL      |
| type       | TEXT    | NOT NULL             |
| role       | TEXT    |                      |
| persona    | TEXT    |                      |
| created_at | INTEGER | NOT NULL             |

### humans
| Column     | Type    | Constraints          |
|------------|---------|----------------------|
| id         | TEXT    | PRIMARY KEY          |
| name       | TEXT    | UNIQUE NOT NULL      |
| created_at | INTEGER | NOT NULL             |

### room_members
| Column      | Type    | Constraints                          |
|-------------|---------|--------------------------------------|
| room_id     | TEXT    | NOT NULL, FK rooms(id)               |
| member_id   | TEXT    | NOT NULL                             |
| member_type | TEXT    | NOT NULL ('agent' or 'human')        |
| joined_at   | INTEGER | NOT NULL                             |
| PRIMARY KEY | (room_id, member_id)                          |

### messages
Unchanged from previous schema. See `docs/protocol.md`.

## REST API

All endpoints are served by the workspace's server instance.

### Rooms
| Method | Path                              | Description                    |
|--------|-----------------------------------|--------------------------------|
| POST   | `/api/rooms`                      | Create room `{name}`           |
| GET    | `/api/rooms`                      | List all rooms                 |
| DELETE | `/api/rooms/:roomId`              | Destroy room                   |
| GET    | `/api/rooms/:roomId/members`      | Get connected WebSocket members|
| GET    | `/api/rooms/:roomId/messages`     | Get room messages              |
| GET    | `/api/rooms/:roomId/registered-members` | Get DB-registered members |

### Agents
| Method | Path                              | Description              |
|--------|-----------------------------------|--------------------------|
| POST   | `/api/agents`                     | Create `{name, type, role?, persona?}` |
| GET    | `/api/agents`                     | List all agents          |
| GET    | `/api/agents/:id`                 | Get agent by UUID or name|
| POST   | `/api/agents/:id/join/:roomId`    | Agent joins room         |
| POST   | `/api/agents/:id/leave/:roomId`   | Agent leaves room        |

### Humans
| Method | Path                              | Description              |
|--------|-----------------------------------|--------------------------|
| POST   | `/api/humans`                     | Create `{name}`          |
| GET    | `/api/humans`                     | List all humans          |
| GET    | `/api/humans/:id`                 | Get human by UUID or name|
| POST   | `/api/humans/:id/join/:roomId`    | Human joins room         |
| POST   | `/api/humans/:id/leave/:roomId`   | Human leaves room        |

### Names
| Method | Path                       | Description                       |
|--------|----------------------------|-----------------------------------|
| GET    | `/api/names/check?name=x`  | Check name availability           |

Room IDs in join/leave endpoints accept either UUID or name.

## CLI Commands

### Server Management
```bash
skynet server new          # Create workspace (interactive: name, host, port)
skynet server list         # List all workspaces
skynet server              # Select and start a server
skynet server start [id]   # Start a specific server
```

### Room Management
```bash
skynet room new   [--server <id>]  # Create room (interactive name prompt)
skynet room list  [--server <id>]  # List all rooms
```

### Agent Management
```bash
skynet agent new   [--server <id>]              # Create agent (interactive)
skynet agent list  [--server <id>]              # List agents
skynet agent join <agent> <room> [--server <id>] # Agent joins room
skynet agent leave <agent> <room> [--server <id>] # Agent leaves room
skynet agent       [--server <id>]              # Select agent, start idle
```

### Human Management
```bash
skynet human new   [--server <id>]               # Create human (interactive)
skynet human list  [--server <id>]               # List humans
skynet human join <human> <room> [--server <id>]  # Human joins room
skynet human leave <human> <room> [--server <id>] # Human leaves room
skynet human       [--server <id>]               # Select human, start chat TUI
```

### Status
```bash
skynet status [room-id] [--server <id>]  # Show server/room status
```

All commands that need a server context use `--server <uuid|name>`. If omitted, a single-server workspace is auto-selected; multiple workspaces trigger an interactive prompt.

## Chat TUI Slash Commands

Within the chat TUI, these management commands are available:

```
/room list                     List rooms
/room new <name>               Create a room
/agent list                    List agents
/agent <name> join <room>      Add agent to room
/agent <name> leave <room>     Remove agent from room
/human list                    List humans
/human <name> join <room>      Add human to room
/human <name> leave <room>     Remove human from room
```

## Entity Lifecycle

1. **Create workspace**: `skynet server new` - creates config, registers in `servers.json`
2. **Start server**: `skynet server` - starts the WebSocket server with the workspace's DB
3. **Create entities**: `skynet room/agent/human new` - requires running server, goes through REST API
4. **Join rooms**: `skynet agent/human join <entity> <room>` - registers membership in DB
5. **Start participants**: `skynet agent` or `skynet human` - starts in idle state, use join commands to connect to rooms
