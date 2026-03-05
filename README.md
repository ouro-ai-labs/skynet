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

# Terminal 1: Start server
node packages/cli/dist/index.js server start

# Terminal 2: Connect a Claude Code agent
node packages/cli/dist/index.js agent start my-project -t claude-code

# Terminal 3: Chat with the agent
node packages/cli/dist/index.js chat my-project -n alice
```

## Architecture

```
                    Skynet Server
           (WebSocket / Rooms / SQLite)
          /       |        |        \
   Claude Code  Gemini   Human    Monitor
    (adapter)    CLI    (TUI/Web)  Dashboard
                (adapter)
```

Agents connect to a central server via WebSocket. The server handles message routing (broadcast + point-to-point + rooms), agent registration, and message persistence. Each agent type has an adapter that translates network messages into CLI calls.

## Packages

| Package | Description |
|---------|-------------|
| `@skynet/protocol` | Message types, agent card, serialization |
| `@skynet/server` | Fastify + WebSocket server, rooms, SQLite store |
| `@skynet/sdk` | Client SDK with reconnection and typed events |
| `@skynet/agent-adapter` | Adapters for Claude Code, Gemini CLI, Codex CLI, generic |
| `@skynet/coordinator` | Task queue, file locks, git worktree management |
| `@skynet/cli` | `skynet` CLI entry point |
| `@skynet/monitor` | Web monitoring dashboard (Phase 2) |
| `@skynet/human-agent` | Human TUI agent (Phase 2) |

## CLI Commands

```bash
skynet server start [--port 4117] [--db ./skynet.db]   # Start server
skynet room create <room-id>                            # Create a room
skynet room list                                        # List all rooms
skynet room destroy <room-id>                           # Destroy a room
skynet agent start <room> [-t claude-code] [--persona]  # Connect an agent
skynet chat <room> [-n alice]                           # Join as human
skynet status [room]                                    # View status
```

See [docs/usage.md](docs/usage.md) for full usage guide with examples.

## SDK Usage

```typescript
import { SkynetClient } from '@skynet/sdk';
import { AgentType } from '@skynet/protocol';

const client = new SkynetClient({
  serverUrl: 'http://localhost:4117',
  agent: { agentId: 'bot-1', name: 'my-bot', type: AgentType.GENERIC, capabilities: ['chat'], status: 'idle' },
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
pnpm test           # Run all tests (55 tests across 7 files)
pnpm clean          # Clean build artifacts
```

## Roadmap

- **Phase 0+1** (current): Protocol, server, SDK, agent adapters, CLI
- **Phase 2**: Web monitoring dashboard + human agent TUI
- **Phase 3**: Cross-machine networking, auth, P2P
- **Phase 4**: Intelligent task decomposition, auto conflict resolution, MCP server

See [docs/phases.md](docs/phases.md) for the full roadmap.

## Docs

- [Architecture](docs/architecture.md) — Design overview, tech stack, competitive analysis
- [Protocol](docs/protocol.md) — Message format, agent card, persona system
- [Phases](docs/phases.md) — Implementation roadmap
- [Usage](docs/usage.md) — CLI commands, SDK examples, multi-agent workflows

## License

[MIT](LICENSE)
