# Skynet Implementation Phases

## Phase 0: Protocol Design & Core Infrastructure (2-3 weeks)

### Goal
Establish the message protocol, server framework, and base SDK so that two nodes can send messages to each other through the server.

### Components to Build
1. **`packages/protocol`** - Message type definitions, serialization/deserialization
2. **`packages/server`** - WebSocket server, room management, message routing
3. **`packages/sdk`** - Client SDK for agents to connect to the server
4. **`packages/cli`** - CLI entry point skeleton

### Key Files
- `packages/protocol/src/types.ts` - All message and type definitions
- `packages/server/src/server.ts` - WebSocket server main body
- `packages/server/src/room.ts` - Room management (one project = one room)
- `packages/server/src/store.ts` - SQLite message persistence
- `packages/sdk/src/client.ts` - SkynetClient class

### Validation
- Start server, connect two SDK clients to the same room, exchange messages, verify correct routing

---

## Phase 1: MVP - Local Multi-Agent Collaboration (4-5 weeks)

### Goal
User runs a single command to connect local Claude Code / Gemini CLI to the network. Agents can converse and collaborate.

### Core: Agent Adapter System

```typescript
// packages/agent-adapter/src/base-adapter.ts
abstract class AgentAdapter {
  abstract readonly type: AgentType;

  // Convert network messages to CLI agent calls
  abstract handleMessage(msg: SkynetMessage): Promise<SkynetMessage | null>;

  // Execute a standalone task
  abstract executeTask(task: TaskPayload): Promise<TaskResult>;
}
```

### Agent Adapters

**Claude Code Adapter** (`packages/agent-adapter/src/adapters/claude-code.ts`):
- Uses `claude -p "prompt" --output-format json` non-interactive mode
- Each message/task = one `claude -p` call
- Uses `--allowedTools` for permission control
- Uses `--resume` to maintain context continuity

**Gemini CLI Adapter** (`packages/agent-adapter/src/adapters/gemini-cli.ts`):
- Uses `echo "prompt" | gemini` pipe mode

**Codex CLI Adapter** (`packages/agent-adapter/src/adapters/codex-cli.ts`):
- Uses `codex -q "prompt"` quiet mode or pipe mode
- Supports `--full-auto` automatic execution mode

**Generic Adapter** (`packages/agent-adapter/src/adapters/generic.ts`):
- YAML config file based adapter for any CLI agent

### CLI Usage

```bash
# Start server
skynet server start

# Connect an agent (auto-detects locally installed agents, interactive selection)
# Current directory is the project directory
skynet agent start <room-id>
# Interactive flow:
#   Detected local agents: [claude-code] [gemini-cli] [codex-cli]
#   Select agent: > claude-code
#   Connected claude-code to room my-project

# Human joins room via TUI to chat with agents
skynet cli <room-id>

# View room/network status (agent list, tasks, activity)
skynet status [room-id]
```

### Git Collaboration Strategy
- Each agent works in an independent git worktree
- Coordinator logic (can be server-side or a standalone agent) handles:
  - File-level locking: only one agent modifies a file at a time
  - Auto-merge back to main branch after task completion
  - Notify human or designated agent on conflicts

### Components to Build
1. **`packages/agent-adapter`** - Base adapter + Claude Code + Gemini CLI + Codex CLI adapters
2. **`packages/coordinator`** - Task assignment, file locks, git worktree management
3. **Enhanced `packages/cli`** - `skynet server start`, `skynet agent start`, `skynet cli`, `skynet status`

### Key Files
- `packages/agent-adapter/src/adapters/claude-code.ts`
- `packages/agent-adapter/src/adapters/gemini-cli.ts`
- `packages/agent-adapter/src/adapters/codex-cli.ts`
- `packages/coordinator/src/git-manager.ts` - Worktree and merge management
- `packages/coordinator/src/task-queue.ts` - Task queue and assignment
- `packages/cli/src/commands/agent.ts` - Agent start (auto-detect + interactive selection)
- `packages/cli/src/commands/cli.ts` - Human TUI entry point
- `packages/cli/src/commands/status.ts` - Status view

### Validation
- Start server + 2 Claude Code agents, send a task, observe agent auto-pick-up and execute
- Two agents modify different files, auto-merge succeeds

---

## Phase 2: Monitor Dashboard + Human Agent (4-5 weeks)

### Goal
Web dashboard shows real-time agent activity; humans can join the network via terminal or web to participate.

### Monitor Dashboard (`packages/monitor`)

**Backend**: Skynet server already has WebSocket; monitor frontend connects directly.

**Frontend Views**:
1. **Network Topology** - Agent node graph showing type/status/current task
2. **Message Stream** - Slack-like chat interface showing all agent conversations
3. **Task Board** - Kanban view (To Do / In Progress / Done / Failed)
4. **Agent Detail** - Click an agent to view task history and output

### Human Agent

**Terminal Mode** (`packages/human-agent`):
- IRC/Slack-like TUI; human chats with agents in terminal
- Can @agent-name to target specific agent
- Can view and approve/reject agent code changes

**Web Mode**:
- Chat input integrated in Monitor Dashboard
- Supports viewing diffs, approve/reject changes

### Key Files
- `packages/monitor/server/index.ts`
- `packages/monitor/ui/src/views/MessageStream.tsx`
- `packages/monitor/ui/src/views/TaskBoard.tsx`
- `packages/monitor/ui/src/views/NetworkGraph.tsx`
- `packages/human-agent/src/tui.ts`

### Validation
- Open monitor web page, see real-time agent message stream
- Send message via human agent (TUI or Web), agent receives and replies

---

## Phase 3: Cross-Machine Networking (5-7 weeks)

### Goal
Agents and humans across multiple machines form a larger collaboration network.

### Key Changes
1. **Server Deployment** - Deploy server to cloud or publicly accessible machine
2. **Authentication & Authorization** - Room token mechanism; only token holders can join
3. **Git Sync** - Cross-machine relies on git remote (GitHub/GitLab) for code sync
4. **Optional P2P** - Introduce libp2p; server degrades to relay/signaling server; agents can connect directly

```bash
# User A creates network
skynet network create --name my-team-project
# Output: invitation link/token

# User B joins
skynet network join --token sk_xxx
skynet agent start --type claude-code --room my-team-project
```

### Key Files
- `packages/server/src/auth.ts` - Token authentication
- `packages/server/src/sync.ts` - Cross-machine git sync coordination
- `packages/core/src/p2p.ts` - Optional libp2p P2P layer

---

## Phase 4: Advanced Features (Ongoing Iteration)

1. **Intelligent Task Decomposition** - LLM auto-splits large tasks into DAG subtasks, assigned in parallel
2. **Automatic Conflict Resolution** - LLM-assisted three-way merge
3. **Agent Capability Learning** - Route tasks to the best-suited agent based on historical performance
4. **Plugin System** - Third parties can write new agent adapters
5. **MCP Server** - Expose Skynet as an MCP server so any MCP-compatible agent can connect
6. **OpenTelemetry** - Observability and token consumption tracking

---

## Implementation Priority

**Phase 0 + Phase 1 = Usable MVP (6-8 weeks)**
- One person runs server + multiple agents locally, collaborative development

**Phase 2 = Complete Experience (+4-5 weeks)**
- With monitor and human agent, the experience is complete

**Phase 3+ = Extended Scenarios**
- Cross-machine, P2P, advanced features iterated gradually
