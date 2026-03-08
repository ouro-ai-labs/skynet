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

# Start it (auto-selects if only one workspace exists)
skynet workspace
```

### 2. Create Entities

In a new terminal (workspace server must be running):

```bash
# Create an agent
skynet agent new
# > Agent name: backend-dev
# > Agent type: claude-code
# > Role: backend engineer
# Agent 'backend-dev' created.

# Create a human profile
skynet human new
# > Human name: alice
# Human 'alice' created.
```

### 3. Start an Agent

```bash
skynet agent   # Select agent from list, connects to workspace automatically
```

### 4. Chat as a Human

```bash
skynet human   # Select human from list, opens chat TUI
```

---

## Commands

### `skynet workspace`

Manage workspaces.

```bash
skynet workspace new          # Create a new workspace (interactive or --name/--host/--port)
skynet workspace list         # List all workspaces
skynet workspace              # Start the only workspace (errors if multiple exist)
skynet workspace start [id]   # Start a specific workspace by name or UUID
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
| `GET /api/names/check?name=x` | Check name availability |
| `GET /ws` | WebSocket endpoint for agents/clients |

### `skynet agent`

Create, list, and start agents.

```bash
skynet agent new   [--workspace <id>]  # Create agent (interactive)
skynet agent list  [--workspace <id>]  # List all agents
skynet agent       [--workspace <id>]  # Select and start agent
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
skynet human new   [--workspace <id>]  # Create human (interactive)
skynet human list  [--workspace <id>]  # List all humans
skynet human       [--workspace <id>]  # Select human, start chat TUI
```

**`skynet human`** (bare command) selects a registered human and opens the chat TUI.

### `skynet status`

Show the status of the workspace.

```bash
skynet status [--workspace <id>]
```

### Workspace Selection

All commands that need a workspace context use `--workspace <uuid|name>`. If omitted:
- **One workspace exists**: auto-selected
- **Multiple workspaces exist**: command errors out with a message to specify `--workspace`

---

## Chat TUI

The chat TUI (`@skynet-ai/chat`) is an Ink-based terminal interface built with React.

### Slash Commands

Within the chat TUI, these commands are available:

```
/agent list                    List agents
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
skynet workspace

# Terminal 2: Set up the workspace
skynet agent new                         # Create "backend-dev" (claude-code)
skynet agent new                         # Create "frontend-dev" (gemini-cli)
skynet human new                         # Create "lead"

# Terminal 3: Start backend agent
skynet agent   # Select backend-dev — auto-joins workspace

# Terminal 4: Start frontend agent
skynet agent   # Select frontend-dev — auto-joins workspace

# Terminal 5: Chat as human lead
skynet human   # Select lead, opens chat TUI — auto-joins workspace

# In the chat:
# lead> @backend-dev Please implement the /api/users REST endpoint
# lead> @frontend-dev Build a user list component in React
```

---

## Using the SDK Programmatically

You can use `@skynet-ai/sdk` to build custom integrations:

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
