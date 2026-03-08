# Skynet Implementation Phases

## Phase 0: Protocol Design & Core Infrastructure — DONE

### Goal
Establish the message protocol, server framework, and base SDK so that two nodes can send messages to each other through the server.

### Components Built
1. **`packages/protocol`** - Message type definitions, entity types, serialization/deserialization
2. **`packages/workspace`** - WebSocket server, member management, entity management, message routing
3. **`packages/sdk`** - Client SDK for agents to connect to the workspace
4. **`packages/cli`** - CLI entry point skeleton

### Key Files
- `packages/protocol/src/types.ts` - All message and type definitions (AgentCard, HumanProfile, etc.)
- `packages/workspace/src/server.ts` - WebSocket server main body
- `packages/workspace/src/member-manager.ts` - Workspace-level member tracking
- `packages/workspace/src/sqlite-store.ts` - SQLite message + entity persistence
- `packages/sdk/src/client.ts` - SkynetClient class

### Validation
- Start server, connect two SDK clients to the workspace, exchange messages, verify correct routing

---

## Phase 1: MVP - Local Multi-Agent Collaboration — DONE

### Goal
User runs commands to connect local Claude Code / Gemini CLI to the network. Agents can converse and collaborate. Humans can join via a chat TUI.

### Core: Agent Adapter System

```typescript
// packages/agent-adapter/src/base-adapter.ts
abstract class AgentAdapter {
  abstract readonly type: AgentType;

  // Check if CLI tool is installed
  abstract isAvailable(): Promise<boolean>;

  // Convert network messages to CLI agent calls
  abstract handleMessage(msg: SkynetMessage): Promise<SkynetMessage | null>;

  // Execute a standalone task
  abstract executeTask(task: TaskPayload): Promise<TaskResult>;
}
```

### Agent Adapters

**Claude Code Adapter** (`packages/agent-adapter/src/adapters/claude-code.ts`):
- Uses `claude -p "prompt" --output-format text` non-interactive mode
- Each message/task = one `claude -p` call
- Uses `--allowedTools` for permission control

**Gemini CLI Adapter** (`packages/agent-adapter/src/adapters/gemini-cli.ts`):
- Uses `echo "prompt" | gemini` pipe mode

**Codex CLI Adapter** (`packages/agent-adapter/src/adapters/codex-cli.ts`):
- Uses `codex -q "prompt"` quiet mode or pipe mode
- Supports `--full-auto` automatic execution mode

**Generic Adapter** (`packages/agent-adapter/src/adapters/generic.ts`):
- Configurable generic adapter for any CLI agent

### Entity-Based CLI

The CLI uses a workspace-based model with persistent entities. Agents and humans auto-join the workspace when they connect — no manual room management needed.

```bash
# Workspace management
skynet workspace new          # Create workspace (interactive or --name/--host/--port)
skynet workspace list         # List all workspaces
skynet workspace              # Start the only workspace (errors if multiple exist)
skynet workspace start [id]   # Start a specific workspace

# Agent management
skynet agent new   [--workspace <id>]  # Create agent (interactive)
skynet agent list  [--workspace <id>]  # List agents
skynet agent       [--workspace <id>]  # Select agent and start it

# Human management
skynet human new   [--workspace <id>]  # Create human (interactive)
skynet human list  [--workspace <id>]  # List humans
skynet human       [--workspace <id>]  # Select human, start chat TUI

# Status
skynet status [--workspace <id>]
```

All commands that need a workspace context use `--workspace <uuid|name>`. If omitted and only one workspace exists, it is auto-selected. If multiple workspaces exist and `--workspace` is not specified, the command errors out.

### Chat TUI

Built with Ink (React for terminals):

- `@skynet-ai/chat` package, started via `skynet human` command
- Supports @-mentions, slash commands for agent/human management
- Markdown rendering for agent responses
- Session fork: quick replies while agent is busy

### Git Collaboration Strategy
- Each agent works in an independent git worktree
- Coordinator logic handles:
  - File-level locking: only one agent modifies a file at a time
  - Auto-merge back to main branch after task completion
  - Notify human or designated agent on conflicts

### Components Built
1. **`packages/agent-adapter`** - Base adapter + Claude Code + Gemini CLI + Codex CLI + Generic adapters + AgentRunner
2. **`packages/coordinator`** - Task queue, file locks, git worktree management
3. **`packages/cli`** - Full workspace-based CLI with workspace/agent/human commands
4. **`packages/chat`** - Ink-based chat TUI with slash commands and markdown support

### Key Files
- `packages/agent-adapter/src/adapters/claude-code.ts`
- `packages/agent-adapter/src/adapters/gemini-cli.ts`
- `packages/agent-adapter/src/adapters/codex-cli.ts`
- `packages/agent-adapter/src/agent-runner.ts`
- `packages/coordinator/src/git-manager.ts`
- `packages/coordinator/src/task-queue.ts`
- `packages/coordinator/src/file-lock.ts`
- `packages/cli/src/commands/workspace.ts`
- `packages/cli/src/commands/agent.ts`
- `packages/cli/src/commands/human.ts`
- `packages/chat/src/tui.tsx`
- `packages/chat/src/components/App.tsx`
- `packages/chat/src/commands.ts`

### Validation
- Start server + 2 Claude Code agents, send a task, observe agent auto-pick-up and execute
- Two agents modify different files, auto-merge succeeds
- Human joins via chat TUI and communicates with agents

---

## Phase 2: Monitor Dashboard — IN PROGRESS

### Goal
Web dashboard shows real-time agent activity.

### Monitor Dashboard (`packages/monitor`)

**Backend**: Skynet server already has WebSocket + REST API; monitor frontend connects directly.

**Frontend Views** (planned):
1. **Network Topology** - Agent node graph showing type/status/current task
2. **Message Stream** - Slack-like chat interface showing all agent conversations
3. **Task Board** - Kanban view (To Do / In Progress / Done / Failed)
4. **Agent Detail** - Click an agent to view task history and output

### Key Files
- `packages/monitor/server/index.ts` (placeholder)
- `packages/monitor/ui/src/index.ts` (placeholder)

### Validation
- Open monitor web page, see real-time agent message stream
- View agent status and task progress

---

## Phase 3: Cross-Machine Networking (Planned)

### Goal
Agents and humans across multiple machines form a larger collaboration network.

### Key Changes
1. **Server Deployment** - Deploy server to cloud or publicly accessible machine
2. **Authentication & Authorization** - Workspace token mechanism; only token holders can join
3. **Git Sync** - Cross-machine relies on git remote (GitHub/GitLab) for code sync
4. **Optional P2P** - Introduce libp2p; server degrades to relay/signaling server; agents can connect directly

```bash
# User A creates network
skynet network create --name my-team-project
# Output: invitation link/token

# User B joins
skynet network join --token sk_xxx
skynet agent --workspace my-team-project
```

### Key Files
- `packages/workspace/src/auth.ts` - Token authentication
- `packages/workspace/src/sync.ts` - Cross-machine git sync coordination
- `packages/core/src/p2p.ts` - Optional libp2p P2P layer

---

## Phase 4: Advanced Features (Planned)

1. **Intelligent Task Decomposition** - LLM auto-splits large tasks into DAG subtasks, assigned in parallel
2. **Automatic Conflict Resolution** - LLM-assisted three-way merge
3. **Agent Capability Learning** - Route tasks to the best-suited agent based on historical performance
4. **Plugin System** - Third parties can write new agent adapters
5. **MCP Server** - Expose Skynet as an MCP server so any MCP-compatible agent can connect
6. **OpenTelemetry** - Observability and token consumption tracking

---

## Implementation Summary

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | Done | Protocol, server, SDK |
| Phase 1 | Done | Agent adapters, coordinator, CLI, chat TUI |
| Phase 2 | In Progress | Web monitoring dashboard |
| Phase 3 | Planned | Cross-machine networking, auth, P2P |
| Phase 4 | Planned | Advanced features (task decomposition, MCP, etc.) |
