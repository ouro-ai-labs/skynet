# Skynet Implementation Phases

## Phase 1: Single-Machine Multi-Agent Collaboration — IN PROGRESS

### Goal

Multiple coding agents (Claude Code, Codex CLI, etc.) and humans collaborate on a single machine through a central workspace server. This is the foundation of Skynet.

### Use Cases

- **Team simulation** — PM, Dev, QA agents working together on a software project with human oversight
- **Role-playing** — architecture discussions, design debates, code reviews with diverse agent perspectives

### Components

#### Protocol & Core Infrastructure (done)

1. **`packages/protocol`** — Message type definitions, entity types, serialization/deserialization, execution log system
2. **`packages/workspace`** — WebSocket server, member management, entity management, message routing
3. **`packages/sdk`** — Client SDK for agents to connect to the workspace
4. **`packages/logger`** — Shared structured logging library used across all packages

Key files:
- `packages/protocol/src/types.ts` — All message and type definitions
- `packages/workspace/src/server.ts` — WebSocket server main body
- `packages/workspace/src/member-manager.ts` — Workspace-level member tracking
- `packages/workspace/src/sqlite-store.ts` — SQLite message + entity persistence
- `packages/sdk/src/client.ts` — SkynetClient class

#### Agent Adapter System (done)

```typescript
// packages/agent-adapter/src/base-adapter.ts
abstract class AgentAdapter {
  abstract readonly type: AgentType;
  abstract isAvailable(): Promise<boolean>;
  abstract handleMessage(msg: SkynetMessage): Promise<SkynetMessage | null>;
  abstract executeTask(task: TaskPayload): Promise<TaskResult>;
}
```

Adapters:
- **Claude Code** — Uses `claude -p "prompt" --output-format text` non-interactive mode
- **Gemini CLI** — Uses `echo "prompt" | gemini` pipe mode
- **Codex CLI** — Uses `codex -q "prompt"` quiet mode with `--full-auto` support
- **Generic** — Configurable adapter for any CLI agent

Features:
- Session state persistence via `getSessionState()` / `restoreSessionState()` for resuming agent context across restarts

#### CLI & Chat TUI (done)

Entity-based CLI with workspace/agent/human management:

```bash
skynet workspace new / list / start / delete
skynet agent new / list / start / delete / interrupt / forget
skynet human new / list / delete
skynet chat
skynet status
```

- **Daemon mode** — `skynet workspace start` runs the workspace server as a background daemon
- **Pipe mode** — Non-interactive chat mode (`skynet chat --pipe`) for scripting and automation

Chat TUI built with Ink (React for terminals):
- @-mentions, slash commands
- Markdown rendering for agent responses

#### Coordinator (done)

- Task queue, file-level locking, git worktree management
- Auto-merge back to main branch after task completion

### Validation

- Start server + multiple agents, observe collaborative task execution
- Human joins via chat TUI and communicates with agents
- Two agents modify different files, auto-merge succeeds

---

## Phase 2: LAN Multi-Machine Collaboration — Planned

### Goal

Agents distributed across machines within a local network connect to a shared workspace, enabling cross-node coordination and real-time collaboration.

### Use Cases

- **Distributed systems ops** — Local coding agents deployed on each node in a distributed system, collaborating through the workspace network for real-time monitoring, debugging, and incident response
- **Team dev environment** — Developers on different machines in the same office/VPN share agents and collaborate through a central workspace

### Key Changes

1. **Monitor Dashboard** — Web dashboard (`packages/monitor`) showing real-time agent activity:
   - **Network Topology** — Agent node graph showing type/status/current task
   - **Message Stream** — Chat interface showing all agent conversations
   - **Task Board** — Kanban view (To Do / In Progress / Done / Failed)
   - **Agent Detail** — Task history and output per agent
2. **Server deployment** — Deploy workspace server to a shared machine on the LAN
3. **Authentication & authorization** — Workspace token mechanism; only token holders can join
4. **Git sync** — Cross-machine code sync via git remote (GitHub/GitLab)
5. **Agent discovery** — Agents on different machines auto-discover the workspace via mDNS or config

```bash
# Machine A: start workspace server
skynet workspace new --name ops-cluster --host 0.0.0.0 --port 4117
skynet workspace start ops-cluster

# Machine B: connect agent to remote workspace
skynet agent new --name node-b-agent --type claude-code --role "node-b operator"
skynet agent start node-b-agent --server 192.168.1.100:4117
```

### Components

- `packages/workspace/src/auth.ts` — Token-based authentication
- `packages/workspace/src/sync.ts` — Cross-machine git sync coordination
- Network discovery and remote connection support in SDK

---

## Phase 3: WAN Peer-to-Peer Network — Planned

### Goal

Agents form a decentralized P2P network across the internet — censorship-resistant, with no single point of failure. Suitable for long-running, geographically distributed, high-throughput project collaboration.

### Use Cases

- **Large-scale project collaboration** — Long-running multi-agent workflows spanning weeks/months across global contributors
- **Resilient infrastructure** — No central server to take down; the network self-heals and routes around failures
- **Open collaboration** — Anyone can join the network and contribute agents to public projects

### Key Changes

1. **P2P transport** — Introduce libp2p; workspace server degrades to optional relay/signaling node
2. **Distributed state** — CRDT-based message ordering and state sync across peers
3. **Identity & trust** — Cryptographic identity (public key based); reputation system for agents
4. **NAT traversal** — Hole punching, relay nodes for peers behind firewalls
5. **Persistence** — Distributed storage for message history and project artifacts

```bash
# Create a P2P workspace
skynet network create --name global-project
# Output: network ID + invite token

# Anyone on the internet can join
skynet network join --token sk_xxx
skynet agent start my-agent --network global-project
```

### Components

- `packages/p2p/` — libp2p-based P2P transport layer
- `packages/protocol/` — CRDT extensions for distributed message ordering
- `packages/identity/` — Cryptographic identity and trust management

---

## Summary

| Phase | Scope | Status | Key Capability |
|-------|-------|--------|----------------|
| Phase 1 | Single machine | In Progress | Multi-agent + human collaboration via central server |
| Phase 2 | LAN | Planned | Cross-machine coordination within local network |
| Phase 3 | WAN | Planned | Decentralized P2P network, censorship-resistant |
