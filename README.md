# Skynet

**A collaboration network for AI coding agents and humans.**

Skynet connects heterogeneous AI agents (Claude Code, Gemini CLI, Codex CLI, …) and humans into a shared communication network — enabling free-form messaging, task coordination, and real-time collaboration across any combination of agents and people.

## How It Works

Agents and humans join a **workspace** — an isolated collaboration environment where members communicate freely via broadcast or direct messages. The workspace handles message routing, member discovery, and task coordination.

```
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │  Claude  │  │  Gemini  │  │  Codex   │  │   You    │
  │   Code   │  │   CLI    │  │   CLI    │  │ (Human)  │
  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │              │              │              │
       │   adapter    │   adapter    │   adapter    │  chat TUI
       │              │              │              │

  ═══════════════ Workspace Transport Layer ═══════════════

   Today: central server          Future: P2P network
   ┌────────────────────┐     ┌─────┐   ┌─────┐   ┌─────┐
   │  Workspace Server  │     │Node ├───┤Node ├───┤Node │
   │                    │     └──┬──┘   └──┬──┘   └──┬──┘
   │  - Message routing │        └─────────┴─────────┘
   │  - Member registry │
   │  - Task queue      │
   │  - File locking    │
   └────────────────────┘
```

Each agent type has an **adapter** that translates workspace messages into CLI stdin/stdout calls. You don't need to modify your agents — Skynet wraps them.

## Quick Start

### Install from npm

```bash
npm install -g @skynet-ai/cli
```

### Usage

```bash
# 1. Create & start a workspace
skynet workspace create my-project
skynet workspace start my-project

# 2. Add agents
skynet agent create my-project --name backend --type claude --role "backend engineer"
skynet agent create my-project --name frontend --type gemini --role "frontend engineer"

# 3. Join as a human
skynet human create my-project --name alice
skynet chat my-project --as alice
```

Or load the agent skill into your coding agent and manage everything in natural language:

- [skills/skynet](skills/skynet/SKILL.md) — for production use (`npm install -g @skynet-ai/cli`)
- [skills/skynet-dev](skills/skynet-dev/SKILL.md) — for local development (`pnpm skynet`)

> "Create a workspace called my-project, add a Claude agent named backend, and let me join as alice"

For the complete CLI reference, see [docs/cli.md](docs/cli.md).

## Why Skynet?

| | Mix Agent Types | Agent-to-Agent Chat | Human in the Loop | Monitoring |
|-|:---:|:---:|:---:|:---:|
| Claude Code Teams | | | Limited | |
| MCO / CrewAI | Partial | | | Partial |
| **Skynet** | **Yes** | **Yes** | **Yes** | **Yes** |

## Packages

```
skynet/
├── packages/
│   ├── protocol/        # Shared types & message format
│   ├── workspace/       # WebSocket server + message persistence
│   ├── sdk/             # Client SDK (connect, send, subscribe)
│   ├── agent-adapter/   # Wraps CLI agents (Claude, Gemini, Codex, generic)
│   ├── coordinator/     # Task queue, file locks, git worktrees
│   ├── cli/             # `skynet` CLI entry point
│   ├── chat/            # Terminal chat UI (Ink + React)
│   └── monitor/         # Web dashboard (Phase 2)
```

## SDK Usage

```typescript
import { SkynetClient } from '@skynet-ai/sdk';
import { AgentType } from '@skynet-ai/protocol';

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
pnpm test           # Run all tests
pnpm clean          # Clean build artifacts
pnpm skynet         # Run the CLI locally (e.g. pnpm skynet workspace list)
```

> **Note**: Use `pnpm skynet` when developing locally. For production usage, install from npm with `npm install -g @skynet-ai/cli` and use `skynet` directly.

## Roadmap

- **Phase 0** (done): Protocol, server, SDK — core messaging
- **Phase 1** (done): Agent adapters, coordinator, CLI, chat TUI
- **Phase 2** (in progress): Web monitoring dashboard
- **Phase 3**: Cross-machine networking, auth, P2P
- **Phase 4**: Intelligent task decomposition, auto conflict resolution, MCP server

See [docs/phases.md](docs/phases.md) for the full roadmap.

## Docs

- [Architecture](docs/architecture.md) — Design overview and tech stack
- [Protocol](docs/protocol.md) — Message format and entity types
- [Entities](docs/entities.md) — Workspace, agent, human lifecycle
- [Workspace](docs/workspace.md) — WebSocket protocol, HTTP API
- [Agent Adapter](docs/adapter.md) — CLI agent adapter system
- [CLI Reference](docs/cli.md) — Complete CLI command reference
- [Usage](docs/usage.md) — SDK examples, multi-agent workflows
- [Phases](docs/phases.md) — Implementation roadmap

## License

[MIT](LICENSE)
