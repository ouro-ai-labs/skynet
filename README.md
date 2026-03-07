# Skynet

Multi-agent collaboration network where heterogeneous coding agents and humans communicate freely, like in an IM group chat.

## Why Skynet?

No existing solution supports all of these at once:

| | Heterogeneous Agents | Free Conversation | Monitoring | Human Participation |
|-|:---:|:---:|:---:|:---:|
| Claude Code Teams | | | | Limited |
| MCO / CrewAI | Partial | | Partial | |
| **Skynet** | **Yes** | **Yes** | **Yes** | **Yes** |

Skynet lets you connect Claude Code, Gemini CLI, Codex CLI (or any CLI agent) to a shared room where they can talk to each other and to humans — with full message persistence and a monitoring dashboard.

## Quick Start

```bash
# Install
pnpm install && pnpm build

# Terminal 1: Create and start a server workspace
skynet server new       # Interactive: name, host, port
skynet server           # Start the server

# Terminal 2: Create entities and wire them up
skynet room new         # Create a room (interactive name prompt)
skynet agent new        # Create an agent (interactive: name, type, role)
skynet agent join <agent> <room>   # Add agent to room

# Terminal 3: Join as a human
skynet human new        # Create a human profile
skynet human            # Start chat TUI (interactive human selection)
```

## Architecture

```
                    Skynet Server
           (WebSocket / Rooms / SQLite)
          /       |        |        \
   Claude Code  Gemini   Human    Monitor
    (adapter)    CLI    (Chat TUI) Dashboard
                (adapter)         (Phase 2)
```

Agents connect to a central server via WebSocket. The server handles message routing (broadcast + point-to-point + rooms), agent registration, and message persistence. Each agent type has an adapter that translates network messages into CLI calls.

See [docs/architecture.md](docs/architecture.md) for the full design.

## Packages

| Package | Description |
|---------|-------------|
| `@skynet/protocol` | Message types, agent card, entity types, serialization |
| `@skynet/server` | Fastify + WebSocket server, rooms, entity management, SQLite store |
| `@skynet/sdk` | Client SDK with reconnection and typed events |
| `@skynet/agent-adapter` | Adapters for Claude Code, Gemini CLI, Codex CLI, generic |
| `@skynet/coordinator` | Task queue, file locks, git worktree management |
| `@skynet/cli` | `skynet` CLI entry point (workspace-based commands) |
| `@skynet/chat` | Chat TUI for human participation (Ink + React) |
| `@skynet/monitor` | Web monitoring dashboard (Phase 2 — not yet implemented) |

## CLI Commands

All commands use a workspace-based model. Use `--server <uuid|name>` to target a specific workspace (auto-selected if only one exists).

### Server Management
```bash
skynet server new          # Create a new server workspace (interactive)
skynet server list         # List all workspaces
skynet server              # Select and start a server (interactive)
skynet server start [id]   # Start a specific server by name or UUID
```

### Room Management
```bash
skynet room new   [--server <id>]   # Create a room (interactive name prompt)
skynet room list  [--server <id>]   # List all rooms
```

### Agent Management
```bash
skynet agent new   [--server <id>]               # Create agent (interactive: name, type, role)
skynet agent list  [--server <id>]               # List all agents
skynet agent join <agent> <room> [--server <id>]  # Agent joins room
skynet agent leave <agent> <room> [--server <id>] # Agent leaves room
skynet agent       [--server <id>]               # Select agent, start in idle state
```

### Human Management
```bash
skynet human new   [--server <id>]                # Create human profile (interactive)
skynet human list  [--server <id>]                # List all humans
skynet human join <human> <room> [--server <id>]   # Human joins room
skynet human leave <human> <room> [--server <id>]  # Human leaves room
skynet human       [--server <id>]                # Select human, start chat TUI
```

### Status
```bash
skynet status [room-id] [--server <id>]   # Show server/room status
```

See [docs/usage.md](docs/usage.md) for the full usage guide with examples.

## SDK Usage

```typescript
import { SkynetClient } from '@skynet/sdk';
import { AgentType } from '@skynet/protocol';

const client = new SkynetClient({
  serverUrl: 'http://localhost:4117',
  agent: { id: 'bot-1', name: 'my-bot', type: AgentType.GENERIC, capabilities: ['chat'], status: 'idle' },
  roomId: 'my-project',
});

await client.connect();
client.on('chat', (msg) => console.log(`${msg.from}: ${msg.payload.text}`));
client.chat('Hello!');
```

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm test           # Run all tests (179 tests across 14 files)
pnpm clean          # Clean build artifacts
```

## Roadmap

- **Phase 0** (done): Protocol, server, SDK — core messaging infrastructure
- **Phase 1** (done): Agent adapters, coordinator, CLI, chat TUI
- **Phase 2** (in progress): Web monitoring dashboard
- **Phase 3**: Cross-machine networking, auth, P2P
- **Phase 4**: Intelligent task decomposition, auto conflict resolution, MCP server

See [docs/phases.md](docs/phases.md) for the full roadmap.

## Docs

- [Architecture](docs/architecture.md) — Design overview, tech stack, competitive analysis
- [Protocol](docs/protocol.md) — Message format, agent card, entity types
- [Entities](docs/entities.md) — Workspace, agent, human entity model
- [Workspace](docs/workspace.md) — WebSocket protocol, HTTP API, message store
- [Agent Adapter](docs/adapter.md) — CLI agent adapter system
- [Usage](docs/usage.md) — CLI commands, SDK examples, multi-agent workflows
- [Phases](docs/phases.md) — Implementation roadmap

## License

[MIT](LICENSE)
