# Skynet CLI Reference

Complete reference for the `skynet` command-line interface.

## Global Behavior

- **Workspace auto-selection**: when only one workspace exists, it is automatically selected. When multiple workspaces exist, you must pass `--workspace <name-or-id>`.
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

Start a workspace server. Accepts a workspace name or UUID as a positional argument, or via `--workspace <name-or-id>`. By default runs in the foreground; use `-d` to run as a background daemon.

```bash
# Start in foreground (default)
skynet workspace start my-project

# Start as a background daemon
skynet workspace start my-project -d

# Auto-select (only works when a single workspace exists)
skynet workspace start
skynet workspace start -d
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID (alternative to positional arg) |
| `-d, --daemon` | Run in background as a daemon process |

### `skynet workspace stop [name-or-id]`

Stop a workspace daemon process.

```bash
skynet workspace stop my-project
```

### `skynet workspace status [name-or-id]`

Show whether the workspace daemon is running and its PID.

```bash
skynet workspace status my-project
```

### `skynet workspace logs [name-or-id]`

Tail the workspace server log file.

```bash
skynet workspace logs my-project
skynet workspace logs my-project -n 100    # Show last 100 lines
skynet workspace logs my-project --no-follow  # Don't follow
```

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --lines <count>` | Number of lines to show | `50` |
| `-f, --follow` | Follow log output | `true` |

### `skynet workspace delete <id>`

Delete a workspace and all its data (agents, messages, config) by UUID. Prompts for confirmation unless `--force` is passed.

```bash
# With confirmation prompt
skynet workspace delete e68fa4c2-37d6-40e0-b62b-1c572a5e4489

# Skip confirmation
skynet workspace delete e68fa4c2-37d6-40e0-b62b-1c572a5e4489 --force
```

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation prompt |

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
skynet agent new --workspace <name-or-id>

# Non-interactive
skynet agent new --workspace <name-or-id> --name coder --type claude-code --role "backend developer"
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--name <name>` | Agent name |
| `--type <type>` | Agent type: `claude-code`, `gemini-cli`, `codex-cli`, `generic` |
| `--role <role>` | Agent role description (optional) |
| `--persona <persona>` | Persona description (optional) |
| `--workdir <path>` | Custom working directory (default: `~/.skynet/<ws>/<id>/work`) |
| `--skills <spec...>` | Install skills via `npx skills add` (repeatable, format: `source[:skill-name]`) |

The command auto-detects which agent CLIs are available on your system and presents them as choices in interactive mode.

Skills are installed into the agent's working directory after creation. The skill source can be a GitHub repo, local path, or any source supported by `npx skills add`. Append `:skill-name` to select a specific skill from a multi-skill source. In interactive mode, you can enter comma-separated skill specs when prompted.

### `skynet agent start <name-or-id>`

Start an agent by name or UUID. Connects to the workspace via WebSocket and begins processing messages. By default runs in the foreground; use `-d` to run as a background daemon. Press `Ctrl+C` to disconnect in foreground mode.

```bash
# Start in foreground (default)
skynet agent start coder

# Start as a background daemon
skynet agent start coder -d
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `-d, --daemon` | Run in background as a daemon process |

### `skynet agent stop <name-or-id>`

Stop an agent daemon process.

```bash
skynet agent stop coder --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

### `skynet agent status <name-or-id>`

Show whether the agent daemon is running and its PID.

```bash
skynet agent status coder --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

### `skynet agent logs <name-or-id>`

Tail the agent log file.

```bash
skynet agent logs coder --workspace <name-or-id>
skynet agent logs coder -n 100    # Show last 100 lines
```

| Flag | Description | Default |
|------|-------------|---------|
| `--workspace <name-or-id>` | Workspace name or UUID | |
| `-n, --lines <count>` | Number of lines to show | `50` |
| `-f, --follow` | Follow log output | `true` |

### `skynet agent list`

List all registered agents with name, type, role, and UUID.

```bash
skynet agent list --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

### `skynet agent delete <id>`

Delete an agent by UUID. Requires a running workspace server. Prompts for confirmation unless `--force` is passed. Returns an error if the agent is currently connected.

```bash
skynet agent delete a1b2c3d4-... --workspace <name-or-id>

# Skip confirmation
skynet agent delete a1b2c3d4-... --force
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--force` | Skip confirmation prompt |

### `skynet agent interrupt <name-or-id>`

Interrupt a running agent, cancelling its current task. Equivalent to pressing `Ctrl+C` in an interactive Claude Code session. The agent remains connected and can receive new tasks.

```bash
skynet agent interrupt coder --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

Returns an error if the agent is not found (404) or not connected (409).

### `skynet agent forget <name-or-id>`

Reset an agent's conversation session, clearing all accumulated context. The agent starts fresh as if it were just created, while remaining connected to the workspace. Useful when reassigning an agent to an unrelated task.

```bash
skynet agent forget coder --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

Returns an error if the agent is not found (404) or not connected (409).

### `skynet agent` (bare)

Interactive shortcut: select a registered agent and start it (connects to the workspace via WebSocket). Press `Ctrl+C` to disconnect.

```bash
skynet agent --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

---

## `skynet human` — Manage Human Profiles

### `skynet human new`

Register a new human profile in the workspace.

```bash
# Interactive
skynet human new --workspace <name-or-id>

# Non-interactive
skynet human new --workspace <name-or-id> --name alice
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--name <name>` | Human name |

### `skynet human list`

List all registered humans with name and UUID.

```bash
skynet human list --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

### `skynet human delete <id>`

Delete a human by UUID. Requires a running workspace server. Prompts for confirmation unless `--force` is passed. Returns an error if the human is currently connected.

```bash
skynet human delete a1b2c3d4-... --workspace <name-or-id>

# Skip confirmation
skynet human delete a1b2c3d4-... --force
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--force` | Skip confirmation prompt |

---

## `skynet chat` — Start Chat TUI

Launch the chat terminal UI to participate in the workspace as a human.

```bash
# Auto-select human (when only one is registered)
skynet chat --workspace <name-or-id>

# Specify human by name
skynet chat --workspace <name-or-id> --name alice

# Auto-select workspace (when only one exists)
skynet chat
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--name <name>` | Human name (skip selection prompt) |

When multiple humans are registered and `--name` is not provided, an interactive selection prompt is shown.

---

## `skynet status` — Show Workspace Status

Display connected members, registered agents, and registered humans for a workspace.

```bash
skynet status --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

Output includes:
- Workspace name and server URL
- Agents — id, name, type, role, persona, and online status (idle/busy/offline)
- Humans — id, name, and online status (online/offline)

---

## Typical Workflow

```bash
# 1. Create a workspace
skynet workspace new --name my-project --port 4117

# 2. Start the workspace server (foreground)
skynet workspace start my-project

# 3. Register participants (in another terminal)
skynet agent new --name coder --type claude-code --role "full-stack developer"
skynet human new --name alice

# 4. Start the agent (non-interactive)
skynet agent start coder

# 5. Join the chat as a human (in another terminal)
skynet chat

# 6. Check workspace status
skynet status
```

### Daemon Workflow

Use `-d` to run workspace and agents in the background without occupying terminals:

```bash
# 1. Create and start workspace in background
skynet workspace new --name my-project --port 4117
skynet workspace start my-project -d

# 2. Register and start agents in background
skynet agent new --name coder --type claude-code --role "full-stack developer"
skynet agent start coder -d

# 3. Check status / view logs
skynet workspace status my-project
skynet agent logs coder

# 4. Stop everything when done
skynet agent stop coder
skynet workspace stop my-project
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
│   ├── logs/
│   │   ├── server.log            # Workspace server logs
│   │   └── <agent-uuid>.log      # Agent logs
│   ├── pids/
│   │   ├── server.pid            # Workspace daemon PID
│   │   └── agent-<agent-uuid>.pid  # Agent daemon PID
│   └── <agent-uuid>/
│       ├── profile.md            # Agent profile
│       ├── agent.json            # Local config (custom workdir, etc.)
│       └── work/                 # Agent working directory (default)
```
