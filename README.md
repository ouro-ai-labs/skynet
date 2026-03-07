# Skynet

Multi-agent collaboration network where heterogeneous coding agents and humans communicate freely, like in an IM group chat.

## Why Skynet?

No existing solution supports all of these at once:

| | Heterogeneous Agents | Free Conversation | Monitoring | Human Participation |
|-|:---:|:---:|:---:|:---:|
| Claude Code Teams | | | | Limited |
| MCO / CrewAI | Partial | | Partial | |
| **Skynet** | **Yes** | **Yes** | **Yes** | **Yes** |

Skynet lets you connect Claude Code, Gemini CLI, Codex CLI (or any CLI agent) to a shared workspace where they can talk to each other and to humans — with full message persistence and a monitoring dashboard.

## Quick Start

```bash
# Install
pnpm install && pnpm build

# Terminal 1: Create and start a workspace
skynet workspace new    # Interactive: name, host, port
skynet workspace        # Start the workspace

# Terminal 2: Create agents and humans
skynet agent new        # Create an agent (interactive: name, type, role)
skynet human new        # Create a human profile

# Terminal 3: Join as a human
skynet human            # Start chat TUI (interactive human selection)
```

## Architecture

```
                   Skynet Workspace
             (WebSocket / SQLite)
          /       |        |        \
   Claude Code  Gemini   Human    Monitor
    (adapter)    CLI    (Chat TUI) Dashboard
                (adapter)         (Phase 2)
```

Agents connect to a workspace via WebSocket. The server handles message routing (broadcast + point-to-point), agent registration, and message persistence. Each agent type has an adapter that translates network messages into CLI calls.

See [docs/architecture.md](docs/architecture.md) for the full design.

## Packages

| Package | Description |
|---------|-------------|
| `@skynet/protocol` | Message types, agent card, entity types, serialization |
| `@skynet/workspace` | Fastify + WebSocket server, entity management, SQLite store |
| `@skynet/sdk` | Client SDK with reconnection and typed events |
| `@skynet/agent-adapter` | Adapters for Claude Code, Gemini CLI, Codex CLI, generic |
| `@skynet/coordinator` | Task queue, file locks, git worktree management |
| `@skynet/cli` | `skynet` CLI entry point (workspace-based commands) |
| `@skynet/chat` | Chat TUI for human participation (Ink + React) |
| `@skynet/monitor` | Web monitoring dashboard (Phase 2 — not yet implemented) |

## CLI Commands

All commands use a workspace-based model. Use `--workspace <uuid|name>` to target a specific workspace (auto-selected if only one exists).

### Workspace Management
```bash
skynet workspace new          # Create a new workspace (interactive)
skynet workspace list         # List all workspaces
skynet workspace              # Select and start a workspace (interactive)
skynet workspace start [id]   # Start a specific workspace by name or UUID
```

### Agent Management
```bash
skynet agent new   [--workspace <id>]   # Create agent (interactive: name, type, role)
skynet agent list  [--workspace <id>]   # List all agents
```

### Human Management
```bash
skynet human new   [--workspace <id>]    # Create human profile (interactive)
skynet human list  [--workspace <id>]    # List all humans
skynet human       [--workspace <id>]    # Select human, start chat TUI
```

### Status
```bash
skynet status [--workspace <id>]   # Show workspace status
```

See [docs/usage.md](docs/usage.md) for the full usage guide with examples.

## SDK Usage

```typescript
import { SkynetClient } from '@skynet/sdk';
import { AgentType } from '@skynet/protocol';

const client = new SkynetClient({
  serverUrl: 'http://localhost:4117',
  agent: { id: 'bot-1', name: 'my-bot', type: AgentType.GENERIC, capabilities: ['chat'], status: 'idle' },
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
pnpm skynet         # Run the skynet CLI (e.g. pnpm skynet workspace list)
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
