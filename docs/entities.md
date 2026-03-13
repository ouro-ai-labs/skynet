# Skynet Entity Model

## Overview

Skynet uses a simple two-level entity model: **Workspace > Agent, Human**. Each workspace is an isolated unit with its own database, configuration, and entities. There are no rooms — agents and humans communicate directly within the workspace.

## Entity Types

### Workspace

The top-level isolation unit. Each workspace has:
- A UUID identifier
- A human-readable name
- Host and port configuration
- Its own SQLite database (`data.db`)
- Agent directories with profiles and work dirs

### Agent

An AI agent instance within a workspace.
- UUID + unique name
- Type: `claude-code`, `gemini-cli`, `codex-cli`, `generic`
- Optional role and persona description
- Automatically joins the workspace upon connection
- Has a local work directory and profile

### Human

A human participant within a workspace.
- UUID + unique name
- Automatically joins the workspace upon connection
- Interacts via the chat TUI

## Name Uniqueness

Names are unique **per workspace** across all entity types. An agent and a human cannot share the same name within a workspace. This is enforced at the application level via `checkNameUnique()`.

## Directory Structure

```
~/.skynet/
  servers.json                    # Registry: [{id, name, host, port}]
  {workspace_uuid}/
    data.db                       # SQLite: messages, agents, humans
    {agent_uuid}/
      profile.md                  # Agent name, type, role, persona
      work/                       # Agent working directory
```

## Database Schema

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

### messages
| Column    | Type    | Constraints     |
|-----------|---------|-----------------|
| id        | TEXT    | PRIMARY KEY     |
| type      | TEXT    | NOT NULL        |
| from      | TEXT    | NOT NULL        |
| to        | TEXT    |                 |
| timestamp | INTEGER | NOT NULL        |
| payload   | TEXT    | NOT NULL (JSON) |
| reply_to  | TEXT    |                 |
| mentions  | TEXT    | (JSON array)    |

## REST API

All endpoints are served by the workspace's server instance.

### Members
| Method | Path             | Description                     |
|--------|------------------|---------------------------------|
| GET    | `/api/members`   | Get connected WebSocket members |

### Messages
| Method | Path             | Description                                          |
|--------|------------------|------------------------------------------------------|
| GET    | `/api/messages`  | Get messages (`?limit=100&before=timestamp`)         |

### Agents
| Method | Path                          | Description                              |
|--------|-------------------------------|------------------------------------------|
| POST   | `/api/agents`                 | Create `{name, type, role?, persona?}`   |
| GET    | `/api/agents`                 | List all agents                          |
| GET    | `/api/agents/:id`             | Get agent by UUID or name                |
| POST   | `/api/agents/:id/interrupt`   | Interrupt agent's current task           |
| POST   | `/api/agents/:id/forget`      | Reset agent's conversation session       |

### Humans
| Method | Path              | Description              |
|--------|-------------------|--------------------------|
| POST   | `/api/humans`     | Create `{name}`          |
| GET    | `/api/humans`     | List all humans          |
| GET    | `/api/humans/:id` | Get human by UUID or name|

### Names
| Method | Path                       | Description                       |
|--------|----------------------------|-----------------------------------|
| GET    | `/api/names/check?name=x`  | Check name availability           |

## CLI Commands

### Workspace Management
```bash
skynet workspace new          # Create workspace (interactive or --name/--host/--port)
skynet workspace list         # List all workspaces
skynet workspace start <name-or-id>   # Start a specific workspace by name or UUID
```

### Agent Management
```bash
skynet agent new        --workspace <id>  # Create agent (interactive)
skynet agent list       --workspace <id>  # List agents
skynet agent            --workspace <id>  # Select agent and start it
skynet agent interrupt  <name-or-id>        # Interrupt agent's current task
skynet agent forget     <name-or-id>        # Reset agent's conversation session
```

### Human Management
```bash
skynet human new   --workspace <id>  # Create human (interactive)
skynet human list  --workspace <id>  # List humans
skynet human       --workspace <id>  # Select human, start chat TUI
```

### Status
```bash
skynet status --workspace <id>  # Show workspace status
```

All commands that need a workspace context require `--workspace <uuid|name>`. There is no auto-selection; the command errors out if `--workspace` is omitted.

## Chat TUI Slash Commands

Within the chat TUI, these management commands are available:

```
/agent list                    List agents
/agent interrupt <name>        Interrupt agent's current task
/agent forget <name>           Reset agent's conversation session
/human list                    List humans
```

## Entity Lifecycle

1. **Create workspace**: `skynet workspace new` — creates config, registers in `servers.json`
2. **Start workspace**: `skynet workspace start` — starts the WebSocket server with the workspace's DB
3. **Create entities**: `skynet agent/human new --workspace <id>` — requires running server, goes through REST API
4. **Start participants**: `skynet agent --workspace <id>` or `skynet human --workspace <id>` — connects to the workspace automatically
