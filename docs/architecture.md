# Skynet: Multi-Agent Collaboration Network

## Context

No existing solution simultaneously supports: heterogeneous coding agents (Claude Code, Gemini CLI, Codex CLI, etc.) + instant messaging-style collaboration + monitoring dashboard + human participation. Existing solutions either lock into a single provider (Claude Code Teams), use a centralized orchestrator without agent-to-agent communication (MCO, CrewAI), or are P2P but not oriented toward coding (Shinkai).

Skynet's core idea: **agents and humans communicate and collaborate freely, just like in an IM group chat**.

## Competitive Analysis

| Solution | Heterogeneous Agents | Free Conversation | Monitoring | Human Participation | Gaps |
|----------|---------------------|-------------------|------------|--------------------|----|
| Claude Code Teams | Claude only | No (lead/sub model) | Weak | Limited | Locked to single provider |
| MCO | Supported | No (dispatch model) | Weak | Not supported | Centralized dispatch, no agent-to-agent communication |
| CrewAI/AutoGen | Partial | Limited | Yes | Limited | Oriented toward LLM wrappers, not CLI agents |
| Internet of Agents | Supported | Supported | None | None | Academic project, not productized |
| **Skynet (ours)** | **Supported** | **Supported** | **Supported** | **Supported** | Needs to be built from scratch |

**Conclusion: Worth building. This is a clear market gap.**

---

## Architecture Overview

```
+---------------------------------------------+
|              Skynet Server                   |
|  (Message Routing / Room Mgmt / State Store  |
|   / WebSocket)                               |
+------+----------+----------+----------+-----+
       |          |          |          |
  +----+----+ +---+----+ +--+---+ +----+-----+
  | Claude  | |Gemini  | |Human | | Monitor  |
  | Code    | | CLI    | |Agent | |Dashboard |
  |(adapter)| |(adapter)| |(TUI) | | (Web UI) |
  +---------+ +--------+ +------+ +----------+
```

**Phase 1 uses a central server architecture (similar to IM)**. Agents connect to the server via WebSocket. The server is responsible for:
- Message routing (point-to-point + broadcast + rooms/channels)
- Agent registration and discovery
- Message persistence
- Can later evolve to P2P (server degrades to an optional relay/bootstrap node)

---

## Tech Stack

- **Language**: TypeScript (Node.js)
- **Package Management**: pnpm workspaces + turborepo
- **Server**: Fastify + ws (WebSocket)
- **Storage**: SQLite (better-sqlite3), can switch to PostgreSQL later
- **Frontend (Monitor)**: React + Vite + Tailwind CSS
- **CLI**: Commander.js + chalk
- **Agent Wrapping**: execa (calling CLI agents)
- **Protocol**: Custom JSON protocol (simple, easy to debug)

---

## Project Structure

```
skynet/
├── packages/
│   ├── protocol/          # Message type definitions
│   ├── server/            # Central server (WebSocket + HTTP)
│   ├── sdk/               # Client SDK
│   ├── agent-adapter/     # Agent adapters (Claude Code, Gemini CLI, etc.)
│   ├── coordinator/       # Task assignment, git management
│   ├── monitor/           # Web monitoring dashboard
│   │   ├── server/
│   │   └── ui/
│   ├── chat/              # Chat TUI for human participation
│   └── cli/               # skynet CLI entry point
├── examples/
├── docs/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```
