# Skynet CLI Reference

Complete reference for the `skynet` command-line interface.

## Global Behavior

- **Workspace auto-selection**: when only one workspace exists, it is automatically selected. When multiple workspaces exist, you must pass `--workspace <uuid>`.
- **Interactive prompts**: most commands support both interactive mode (prompts for missing info) and non-interactive mode (pass all values as flags).
- **Configuration**: workspace data is stored in `~/.skynet/` (override with `SKYNET_HOME` env var).

---

## `skynet workspace` — Manage Workspaces

### `skynet workspace new`

Create a new workspace. Interactive by default; pass flags to skip prompts.

```bash
# Interactive
skynet workspace new

# Non-interactive
skynet workspace new --name my-project --host 0.0.0.0 --port 4117
```

| Flag | Description | Default |
|------|-------------|---------|
| `--name <name>` | Workspace name | (prompted) |
| `--host <host>` | Bind address | `0.0.0.0` |
| `--port <port>` | Listen port | `4117` |

Output includes the workspace UUID, host:port, and local data directory.

### `skynet workspace list`

List all configured workspaces with name, host:port, and UUID.

```bash
skynet workspace list
```

### `skynet workspace start [name-or-id]`

Start a workspace server. Accepts a workspace name or UUID as a positional argument, or via `--workspace <uuid>`.

```bash
# Start by name
skynet workspace start my-project

# Start by UUID
skynet workspace start e68fa4c2-37d6-40e0-b62b-1c572a5e4489

# Auto-select (only works when a single workspace exists)
skynet workspace start
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID (alternative to positional arg) |

### `skynet workspace` (bare)

Shortcut: starts the workspace if only one exists. Errors if zero or multiple workspaces are configured.

```bash
skynet workspace
```

---

## `skynet agent` — Manage Agents

### `skynet agent new`

Register a new agent in the workspace. Interactive by default.

```bash
# Interactive
skynet agent new --workspace <uuid>

# Non-interactive
skynet agent new --workspace <uuid> --name coder --type claude-code --role "backend developer"
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |
| `--name <name>` | Agent name |
| `--type <type>` | Agent type: `claude-code`, `gemini-cli`, `codex-cli`, `generic` |
| `--role <role>` | Agent role description (optional) |
| `--persona <persona>` | Persona description (optional) |

The command auto-detects which agent CLIs are available on your system and presents them as choices in interactive mode.

### `skynet agent list`

List all registered agents with name, type, role, and UUID.

```bash
skynet agent list --workspace <uuid>
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |

### `skynet agent` (bare)

Interactive shortcut: select a registered agent and start it (connects to the workspace via WebSocket). Press `Ctrl+C` to disconnect.

```bash
skynet agent --workspace <uuid>
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |

---

## `skynet human` — Manage Human Profiles

### `skynet human new`

Register a new human profile in the workspace.

```bash
# Interactive
skynet human new --workspace <uuid>

# Non-interactive
skynet human new --workspace <uuid> --name alice
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |
| `--name <name>` | Human name |

### `skynet human list`

List all registered humans with name and UUID.

```bash
skynet human list --workspace <uuid>
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |

---

## `skynet chat` — Start Chat TUI

Launch the chat terminal UI to participate in the workspace as a human.

```bash
# Auto-select human (when only one is registered)
skynet chat --workspace <uuid>

# Specify human by name
skynet chat --workspace <uuid> --name alice

# Auto-select workspace (when only one exists)
skynet chat
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |
| `--name <name>` | Human name (skip selection prompt) |

When multiple humans are registered and `--name` is not provided, an interactive selection prompt is shown.

---

## `skynet status` — Show Workspace Status

Display connected members, registered agents, and registered humans for a workspace.

```bash
skynet status --workspace <uuid>
```

| Flag | Description |
|------|-------------|
| `--workspace <uuid>` | Workspace UUID |

Output includes:
- Workspace name and server URL
- Connected members (name, type, status)
- Registered agents (name, type)
- Registered humans (name)

---

## Typical Workflow

```bash
# 1. Create a workspace
skynet workspace new --name my-project --port 4117

# 2. Start the workspace server
skynet workspace start my-project

# 3. Register participants (in another terminal)
skynet agent new --name coder --type claude-code --role "full-stack developer"
skynet human new --name alice

# 4. Start the agent
skynet agent

# 5. Join the chat as a human (in another terminal)
skynet chat

# 6. Check workspace status
skynet status
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SKYNET_HOME` | Override config/data directory | `~/.skynet` |

## Data Directory Layout

```
~/.skynet/
├── servers.json                  # Workspace registry
├── <workspace-uuid>/
│   ├── config.json               # Workspace connection config
│   ├── data.db                   # SQLite message store
│   └── <agent-uuid>/
│       ├── profile.md            # Agent profile
│       └── work/                 # Agent working directory
```
