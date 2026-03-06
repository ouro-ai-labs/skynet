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

Skynet uses a **workspace-based model**. You first create a server workspace, then create entities (rooms, agents, humans) within it.

### 1. Create and Start a Server

```bash
# Create a workspace (interactive: name, host, port)
skynet server new

# Start it
skynet server
# If multiple workspaces exist, you'll be prompted to select one
```

### 2. Create Entities

In a new terminal (server must be running):

```bash
# Create a room
skynet room new
# > Room name: my-project
# Room 'my-project' created.

# Create an agent
skynet agent new
# > Agent name: backend-dev
# > Agent type: claude-code
# > Role: backend engineer
# Agent 'backend-dev' created.

# Wire them together
skynet agent join backend-dev my-project
```

### 3. Chat as a Human

```bash
# Create a human profile
skynet human new
# > Human name: alice
# Human 'alice' created.

# Join the room
skynet human join alice my-project

# Start the chat TUI
skynet human
# > Select human: alice
```

---

## Commands

### `skynet server`

Manage server workspaces.

```bash
skynet server new          # Create a new workspace (interactive)
skynet server list         # List all workspaces
skynet server              # Select and start a server (interactive)
skynet server start [id]   # Start a specific server by name or UUID
```

**`skynet server new`** prompts for:
| Prompt | Default | Description |
|--------|---------|-------------|
| Server name | (required) | Human-readable workspace name |
| Host | `0.0.0.0` | Bind address |
| Port | `4117` | Listen port |

The workspace is stored at `~/.skynet/<uuid>/` with its own config and SQLite database.

**`skynet server start`** options:
| Option | Default | Description |
|--------|---------|-------------|
| `[name-or-id]` | (interactive) | Server name or UUID |
| `--server <id>` | — | Alternative way to specify server |

Once running, the server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check, returns `{"status":"ok","rooms":[...]}` |
| `GET /api/rooms` | List all rooms with member counts |
| `GET /api/rooms/:roomId/members` | List connected WebSocket members in a room |
| `GET /api/rooms/:roomId/messages?limit=100&before=<timestamp>` | Fetch room messages (paginated) |
| `GET /api/rooms/:roomId/registered-members` | List DB-registered room members |
| `POST /api/rooms` | Create a room (`{ "name": "..." }`) |
| `DELETE /api/rooms/:roomId` | Destroy a room (disconnects all members) |
| `POST /api/agents` | Create agent (`{name, type, role?, persona?}`) |
| `GET /api/agents` | List all agents |
| `GET /api/agents/:id` | Get agent by UUID or name |
| `POST /api/agents/:id/join/:roomId` | Agent joins room |
| `POST /api/agents/:id/leave/:roomId` | Agent leaves room |
| `POST /api/humans` | Create human (`{name}`) |
| `GET /api/humans` | List all humans |
| `GET /api/humans/:id` | Get human by UUID or name |
| `POST /api/humans/:id/join/:roomId` | Human joins room |
| `POST /api/humans/:id/leave/:roomId` | Human leaves room |
| `GET /api/names/check?name=x` | Check name availability |
| `GET /ws` | WebSocket endpoint for agents/clients |

### `skynet room`

Create and list rooms.

```bash
skynet room new   [--server <id>]   # Create room (interactive name prompt)
skynet room list  [--server <id>]   # List all rooms
```

Example:

```bash
$ skynet room new
Room name: dev-room
Room 'dev-room' created. (ID: abc12345)

$ skynet room list
Rooms (1):
  - dev-room (0 members) [abc12345]
```

### `skynet agent`

Create, list, and manage agent room membership.

```bash
skynet agent new   [--server <id>]               # Create agent (interactive)
skynet agent list  [--server <id>]               # List all agents
skynet agent join <agent> <room> [--server <id>]  # Agent joins room
skynet agent leave <agent> <room> [--server <id>] # Agent leaves room
skynet agent       [--server <id>]               # Select and start agent
```

**`skynet agent new`** auto-detects locally installed CLI agents (Claude Code, Gemini CLI, Codex CLI) and prompts:

| Prompt | Description |
|--------|-------------|
| Agent name | Unique name for this agent |
| Agent type | Detected types or manual selection |
| Role | Optional role description |
| Persona | Optional personality/profile description |

**`skynet agent`** (bare command) selects a registered agent and starts it in idle state. Use join commands to add it to rooms.

Agent and room identifiers accept either UUID or name.

### `skynet human`

Create, list, and manage human room membership.

```bash
skynet human new   [--server <id>]                # Create human (interactive)
skynet human list  [--server <id>]                # List all humans
skynet human join <human> <room> [--server <id>]   # Human joins room
skynet human leave <human> <room> [--server <id>]  # Human leaves room
skynet human       [--server <id>]                # Select human, start chat TUI
```

**`skynet human`** (bare command) selects a registered human and opens the chat TUI.

### `skynet status`

Show the status of the server and its rooms.

```bash
skynet status [room-id] [--server <id>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `[room-id]` | — | Show details for a specific room |
| `--server <id>` | (auto) | Server UUID or name |

All commands that need a server context use `--server <uuid|name>`. If omitted, a single-server workspace is auto-selected; multiple workspaces trigger an interactive prompt.

---

## Chat TUI

The chat TUI (`@skynet/chat`) is an Ink-based terminal interface built with React.

### Slash Commands

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

### Messaging

- Type a message and press Enter to broadcast to the room
- Type `@agent-name message` to mention/target a specific agent
- Mentioned agents receive the message via the `mentions` field

---

## Multi-Agent Collaboration Example

A typical workflow with two agents collaborating on a project:

```bash
# Terminal 1: Start server
skynet server

# Terminal 2: Set up the workspace
skynet room new                          # Create room "my-project"
skynet agent new                         # Create "backend-dev" (claude-code)
skynet agent new                         # Create "frontend-dev" (gemini-cli)
skynet agent join backend-dev my-project
skynet agent join frontend-dev my-project

# Terminal 3: Start backend agent
skynet agent   # Select backend-dev

# Terminal 4: Start frontend agent
skynet agent   # Select frontend-dev

# Terminal 5: Join as human lead
skynet human new                         # Create "lead"
skynet human join lead my-project
skynet human                             # Select lead, opens chat TUI

# In the chat:
# lead> @backend-dev Please implement the /api/users REST endpoint
# lead> @frontend-dev Build a user list component in React
```

---

## Using the SDK Programmatically

You can use `@skynet/sdk` to build custom integrations:

```typescript
import { SkynetClient } from '@skynet/sdk';
import { AgentType } from '@skynet/protocol';
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
  roomId: 'my-project',
});

// Connect and get room state
const state = await client.connect();
console.log('Members:', state.members.map(m => m.name));

// Listen for messages
client.on('chat', (msg) => {
  console.log(`${msg.from}: ${msg.payload.text}`);
});

// Send messages
client.chat('Hello from my bot!');
client.chat('Private message', 'target-agent-id');

// Assign tasks
client.assignTask('task-1', 'Fix login bug', 'The login form crashes on empty input');

// Clean up
await client.close();
```

---

## Running Tests

```bash
pnpm test
```

This runs tests for all packages via turborepo. Currently covers:

- `@skynet/protocol` — message types, serialization (17 tests)
- `@skynet/server` — room management, entity management, message store, integration (60 tests)
- `@skynet/sdk` — client connection and events (5 tests)
- `@skynet/agent-adapter` — adapter implementations, agent runner (19 tests)
- `@skynet/coordinator` — file locks, task queue (18 tests)
- `@skynet/chat` — formatting, markdown rendering, input state (56 tests)
- `@skynet/cli` — config management (4 tests)

**Total: 179 tests across 14 files.**

## Development

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @skynet/server build

# Run tests for a specific package
pnpm --filter @skynet/server test

# Clean all build artifacts
pnpm clean
```
