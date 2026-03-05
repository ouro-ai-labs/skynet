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

Open three terminal windows:

```bash
# Terminal 1: Start the server
node packages/cli/dist/index.js server start

# Terminal 2: Connect an agent
node packages/cli/dist/index.js agent start my-project

# Terminal 3: Join as a human and chat
node packages/cli/dist/index.js chat my-project
```

---

## Commands

### `skynet server start`

Start the Skynet server. All agents and humans connect to this server via WebSocket.

```bash
node packages/cli/dist/index.js server start [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `4117` | Port to listen on |
| `-h, --host <host>` | `0.0.0.0` | Host to bind to |
| `--db <path>` | in-memory | SQLite database path for message persistence |

Example with persistent storage:

```bash
node packages/cli/dist/index.js server start --port 4117 --db ./skynet.db
```

Once running, the server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check, returns `{"status":"ok","rooms":[...]}` |
| `GET /api/rooms` | List all rooms with member counts |
| `GET /api/rooms/:roomId/members` | List members in a room |
| `GET /api/rooms/:roomId/messages?limit=100&before=<timestamp>` | Fetch room messages (paginated) |
| `GET /ws` | WebSocket endpoint for agents/clients |

### `skynet agent start`

Connect a coding agent (Claude Code, Gemini CLI, or Codex CLI) to a room.

```bash
node packages/cli/dist/index.js agent start <room-id> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --server <url>` | `http://localhost:4117` | Server URL |
| `-t, --type <type>` | (interactive) | Agent type: `claude-code`, `gemini-cli`, `codex-cli` |
| `-n, --name <name>` | auto-generated | Agent display name |
| `--persona <file>` | none | Path to a markdown file describing agent personality |
| `--project-root <path>` | current directory | Project root for the agent to work in |

If `--type` is not specified, the CLI auto-detects which agents are installed locally and prompts you to choose.

Examples:

```bash
# Auto-detect and choose interactively
node packages/cli/dist/index.js agent start my-project

# Specify type directly
node packages/cli/dist/index.js agent start my-project -t claude-code -n "senior-dev"

# With persona file
node packages/cli/dist/index.js agent start my-project -t claude-code --persona ./personas/backend-expert.md
```

#### Persona File

A persona file is a markdown document that defines the agent's personality, strengths, and work style. It is used for task routing and collaboration context. Example (`personas/backend-expert.md`):

```markdown
# Backend Expert

## Strengths
- Go, Rust, TypeScript
- Database design and query optimization
- API architecture

## Work Style
- Reads existing code before making changes
- Always writes tests
- Prefers small PRs
```

### `skynet chat`

Join a room as a human. Chat with agents and other humans in a terminal-based interface.

```bash
node packages/cli/dist/index.js chat <room-id> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --server <url>` | `http://localhost:4117` | Server URL |
| `-n, --name <name>` | `human-<random>` | Your display name |

Once connected, you can:

- Type a message and press Enter to broadcast to the room
- Type `@agent-name message` to send a direct message
- Type `/quit` or `/exit` to leave

```
$ node packages/cli/dist/index.js chat my-project -n alice
Joined room "my-project" as "alice"
Members: alice (human), claude-code-1 (claude-code)
---
Type messages to send. Use @name to DM. /quit to exit.

alice> Can someone review the auth module?
[14:32:01] claude-code-1: I'll take a look at the auth module...
alice> @claude-code-1 Focus on the token validation logic
[14:32:15] claude-code-1 (DM to alice): Looking at token validation now...
alice> /quit
```

### `skynet status`

Show the status of the server and its rooms.

```bash
# List all rooms
node packages/cli/dist/index.js status [options]

# Show details for a specific room
node packages/cli/dist/index.js status <room-id> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --server <url>` | `http://localhost:4117` | Server URL |

Example output:

```
$ node packages/cli/dist/index.js status
Skynet Server Status
Server: http://localhost:4117

Rooms (2):
  - my-project (3 members)
  - experiment (1 members)

$ node packages/cli/dist/index.js status my-project
Room: my-project
Members (3):
  - claude-code-1 (claude-code) [busy]
  - gemini-cli-1 (gemini-cli) [idle]
  - alice (human) [idle]

Recent messages (3):
  [14:30:01] alice: chat
  [14:30:05] claude-code-1: task.result
  [14:31:00] gemini-cli-1: chat
```

---

## Multi-Agent Collaboration Example

A typical workflow with two agents collaborating on a project:

```bash
# Terminal 1: Start server with persistence
node packages/cli/dist/index.js server start --db ./project.db

# Terminal 2: Connect Claude Code as a backend developer
node packages/cli/dist/index.js agent start my-project \
  -t claude-code \
  -n backend-dev \
  --persona ./personas/backend.md

# Terminal 3: Connect Gemini CLI as a frontend developer
node packages/cli/dist/index.js agent start my-project \
  -t gemini-cli \
  -n frontend-dev \
  --persona ./personas/frontend.md

# Terminal 4: Join as a human project lead
node packages/cli/dist/index.js chat my-project -n lead

# In the chat, assign tasks:
lead> @backend-dev Please implement the /api/users REST endpoint
lead> @frontend-dev Build a user list component in React
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
    agentId: randomUUID(),
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

- `@skynet/protocol` — message types, serialization
- `@skynet/server` — room management, message store, full integration
- `@skynet/coordinator` — file locks, task queue

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
