# Skynet CLI Reference

Complete reference for the `skynet` command-line interface.

## Global Behavior

- **Workspace selection**: `--workspace <name-or-id>` is required for all commands that operate on a workspace. There is no auto-selection.
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

Start a workspace server. Accepts a workspace name or UUID as a positional argument or via `--workspace`. By default runs in the foreground; use `-d` to run as a background daemon.

```bash
# Start in foreground (default)
skynet workspace start my-project

# Equivalent using --workspace flag
skynet workspace start --workspace my-project

# Start as a background daemon
skynet workspace start my-project -d
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID (alternative to positional argument) |
| `-d, --daemon` | Run in background as a daemon process |

### `skynet workspace stop <name-or-id>`

Stop a workspace daemon process.

```bash
skynet workspace stop my-project
```

### `skynet workspace status <name-or-id>`

Show whether the workspace daemon is running and its PID.

```bash
skynet workspace status my-project
```

### `skynet workspace logs <name-or-id>`

Tail the workspace server log file.

```bash
skynet workspace logs my-project
skynet workspace logs my-project -n 100    # Show last 100 lines
skynet workspace logs my-project --no-follow  # Don't follow
```

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --lines <count>` | Number of lines to show | `50` |
| `-f, --follow` | Follow log output (use `--no-follow` to disable) | `true` |

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
| `--skills <spec...>` | Install skills (repeatable — pass multiple times or space-separated, format: `source[:skill-name]`) |

The command auto-detects which agent CLIs are available on your system and presents them as choices in interactive mode.

The `--skills` option accepts one or more skill specifiers. You can pass it multiple times or provide several space-separated values:

```bash
# Single skill
skynet agent new --workspace my-project --name coder --type claude-code \
  --skills github.com/org/repo

# Multiple skills
skynet agent new --workspace my-project --name coder --type claude-code \
  --skills github.com/org/repo github.com/org/other-repo

# Select a specific skill from a multi-skill source
skynet agent new --workspace my-project --name coder --type claude-code \
  --skills github.com/org/repo:my-skill
```

Skills are installed into the agent's working directory after creation. The skill source can be a GitHub repo, local path, or any source supported by `npx skills add`. Append `:skill-name` to select a specific skill from a multi-skill source. In interactive mode, you can enter comma-separated skill specs when prompted.

### `skynet agent start <name-or-id>`

Start an agent by name or UUID. Connects to the workspace via WebSocket and begins processing messages. Runs as a background daemon by default; use `-f` to run in the foreground. Press `Ctrl+C` to disconnect in foreground mode.

```bash
# Start as a background daemon (default)
skynet agent start coder

# Start in foreground
skynet agent start coder -f
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `-d, --daemon` | Run as daemon (default, kept for backward compatibility) |
| `-f, --foreground` | Run in foreground instead of daemon mode |

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
| `-f, --follow` | Follow log output (use `--no-follow` to disable) | `true` |

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

Launch the chat terminal UI to participate in the workspace as a human. In pipe mode, the chat reads from stdin and writes to stdout, which is useful for scripting and integration with external tools. In WeChat bridge mode, the chat forwards messages bidirectionally between WeChat and the workspace.

```bash
skynet chat --workspace <name-or-id>

# Specify human by name
skynet chat --workspace <name-or-id> --name alice

# Non-interactive pipe mode (read from stdin, write to stdout)
skynet chat --workspace <name-or-id> --pipe --name alice

# WeChat bridge mode
skynet chat --workspace <name-or-id> --weixin --name alice
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--name <name>` | Human name (skip selection prompt) |
| `--pipe` | Non-interactive pipe mode: read from stdin, write to stdout |
| `--weixin` | WeChat bridge mode: forward messages between WeChat and the workspace |

When multiple humans are registered and `--name` is not provided, an interactive selection prompt is shown. In `--pipe` and `--weixin` modes, `--name` is required when multiple humans exist (there is no interactive prompt to fall back on).

---

## `skynet doctor` — Check System Prerequisites

Run diagnostic checks to verify that your environment is correctly set up for Skynet.

```bash
skynet doctor
```

Checks performed:
- **Node.js** version (>=20 required)
- **pnpm** availability
- **git** version and worktree support
- **Agent CLIs** — reports which of `claude`, `gemini`, `codex` are installed
- **Workspace status** — lists configured workspaces and whether they are running
- **Port availability** — checks whether the default workspace port (4117) is free

Example output:

```
Skynet Doctor

✓ Node.js v20.11.0 (>=20 required)
✓ pnpm 9.1.0
✓ git 2.43.0 (worktree support: yes)

✓ claude (Claude Code CLI)
✗ gemini (not found — install: npm i -g @google/gemini-cli)
✗ codex (not found — install: npm i -g @openai/codex)

✓ No workspace running on port 4117

All checks passed.
```

Exits with code 1 if any critical check fails (Node.js version, pnpm, git) or if the default port availability check fails. Missing agent CLIs are reported but do not cause a non-zero exit.

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

## `skynet schedule` — Manage Scheduled Tasks

Admin commands for managing cron-based recurring tasks. The primary way to create schedules is via natural language in chat (see [scheduler docs](scheduler.md)).

### `skynet schedule list`

List all schedules in a workspace.

```bash
skynet schedule list --workspace <name-or-id>

# Filter by agent
skynet schedule list --workspace <name-or-id> --agent <agent-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--agent <agent-id>` | Filter by agent ID (optional) |

### `skynet schedule delete <id>`

Delete a schedule by ID. Prompts for confirmation unless `--force` is passed.

```bash
skynet schedule delete <schedule-id> --workspace <name-or-id>

# Skip confirmation
skynet schedule delete <schedule-id> --workspace <name-or-id> --force
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--force` | Skip confirmation prompt |

### `skynet schedule enable <id>`

Enable a disabled schedule.

```bash
skynet schedule enable <schedule-id> --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

### `skynet schedule disable <id>`

Disable a schedule without deleting it.

```bash
skynet schedule disable <schedule-id> --workspace <name-or-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |

---

## Typical Workflow

```bash
# 1. Create a workspace
skynet workspace new --name my-project --port 4117

# 2. Start the workspace server (foreground)
skynet workspace start my-project

# 3. Register participants (in another terminal)
skynet agent new --workspace my-project --name coder --type claude-code --role "full-stack developer"
skynet human new --workspace my-project --name alice

# 4. Start the agent (non-interactive)
skynet agent start coder --workspace my-project

# 5. Join the chat as a human (in another terminal)
skynet chat --workspace my-project

# 6. Check workspace status
skynet status --workspace my-project
```

### Daemon Workflow

Agents now default to daemon mode. Use `-d` for workspace to run in the background:

```bash
# 1. Create and start workspace in background
skynet workspace new --name my-project --port 4117
skynet workspace start my-project -d

# 2. Register and start agents (daemon by default)
skynet agent new --workspace my-project --name coder --type claude-code --role "full-stack developer"
skynet agent start coder --workspace my-project

# 3. Check status / view logs
skynet workspace status my-project
skynet agent logs coder --workspace my-project

# 4. Stop everything when done
skynet agent stop coder --workspace my-project
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
