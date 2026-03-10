---
name: skynet
description: Manage the Skynet multi-agent collaboration network using the skynet CLI. Use when creating or managing workspaces, agents, humans, or checking system status.
---

# Skynet Management Skill

You can manage the Skynet multi-agent collaboration network using the `skynet` CLI. All commands below are non-interactive (pass all options as flags) so you can run them directly via your shell tool.

**Prerequisites**: Install the CLI via `npm install -g @skynet-ai/cli`.

---

## Workspace Management

### Create a workspace

```bash
skynet workspace new --name <workspace-name> [--host <host>] [--port <port>]
```

- `--name` (required): Human-readable workspace name
- `--host` (optional): Bind address, default `0.0.0.0`
- `--port` (optional): Port number, default `4117`

### List workspaces

```bash
skynet workspace list
```

### Delete a workspace

```bash
skynet workspace delete <workspace-uuid> --force
```

Removes the workspace from the registry and deletes all its data (agents, messages, config).

### Start a workspace

```bash
# Start in foreground (long-running process)
skynet workspace start <name-or-id>

# Start as a background daemon (recommended for agents)
skynet workspace start <name-or-id> -d
```

### Stop a workspace daemon

```bash
skynet workspace stop <name-or-id>
```

### Check workspace daemon status

```bash
skynet workspace status <name-or-id>
```

### View workspace logs

```bash
skynet workspace logs <name-or-id>
```

---

## Agent Management

All agent commands require a running workspace. Use `--workspace <name-or-id>` if you have multiple workspaces.

### Create an agent

```bash
skynet agent new --name <agent-name> --type <agent-type> [--role <role>] [--persona <persona>] [--workdir <path>] [--workspace <name-or-id>]
```

- `--name` (required): Agent display name
- `--type` (required): One of `claude-code`, `gemini-cli`, `codex-cli`, `generic`
- `--role` (optional): Agent's role description (e.g., "backend engineer")
- `--persona` (optional): Persona description for the agent's behavior
- `--workdir` (optional): Custom working directory (default: `~/.skynet/<ws>/<id>/work`)

### Start an agent

```bash
# Start in foreground
skynet agent start <agent-name-or-id> [--workspace <name-or-id>]

# Start as a background daemon (recommended for agents)
skynet agent start <agent-name-or-id> -d [--workspace <name-or-id>]
```

Connects the agent to the workspace and starts processing messages. Use `-d` to run as a daemon. Press `Ctrl+C` to disconnect in foreground mode.

### Stop an agent daemon

```bash
skynet agent stop <agent-name-or-id> [--workspace <name-or-id>]
```

### Check agent daemon status

```bash
skynet agent status <agent-name-or-id> [--workspace <name-or-id>]
```

### View agent logs

```bash
skynet agent logs <agent-name-or-id> [--workspace <name-or-id>]
```

### Delete an agent

```bash
skynet agent delete <agent-uuid> --force [--workspace <name-or-id>]
```

Deletes the agent from the workspace. Fails if the agent is currently connected.

### Interrupt an agent

```bash
skynet agent interrupt <agent-name-or-id> [--workspace <name-or-id>]
```

Interrupts the agent's currently running task (equivalent to `Ctrl+C`). The agent remains connected and can receive new tasks.

### Reset an agent's session (forget)

```bash
skynet agent forget <agent-name-or-id> [--workspace <name-or-id>]
```

Clears the agent's conversation history so it starts fresh. Useful when reassigning an agent to an unrelated task.

### List agents

```bash
skynet agent list [--workspace <name-or-id>]
```

---

## Human Management

### Create a human

```bash
skynet human new --name <human-name> [--workspace <name-or-id>]
```

### Delete a human

```bash
skynet human delete <human-uuid> --force [--workspace <name-or-id>]
```

Deletes the human from the workspace. Fails if the human is currently connected.

### List humans

```bash
skynet human list [--workspace <name-or-id>]
```

---

## Chat (Human Only)

> **Do NOT run this command yourself.** `skynet chat` launches an interactive TUI for humans to join the workspace. When you need a human to join, tell them to run this command in a separate terminal.

```bash
skynet chat [--name <human-name>] [--workspace <name-or-id>]
```

- `--name` (optional): Human name to join as (skips selection prompt)
- If only one human is registered, it is auto-selected.

---

## Status

### Check workspace status

```bash
skynet status [--workspace <name-or-id>]
```

Shows all registered agents and humans with their id, name, role, persona, and online status.

---

## Typical Workflow

1. **Create a workspace**: `skynet workspace new --name my-project`
2. **Start the workspace**: `skynet workspace start my-project -d`
3. **Create agents**: `skynet agent new --name backend --type claude-code --role "backend engineer"`
4. **Start the agent**: `skynet agent start backend -d`
5. **Create a human**: `skynet human new --name alice`
6. **Human joins chat** (tell them to run): `skynet chat --name alice`
7. **Check status**: `skynet status`
8. **Stop when done**: `skynet agent stop backend && skynet workspace stop my-project`

---

## Logs

All runtime logs are written to `~/.skynet/<workspace-uuid>/logs/`:

- **Server log**: `~/.skynet/<workspace-uuid>/logs/server.log`
- **Agent logs**: `~/.skynet/<workspace-uuid>/logs/<agent-uuid>.log`

---

## Tips

- **CRITICAL**: When deleting workspaces, agents, or humans, you **MUST** always pass `--force`. Without `--force`, the command enters an interactive confirmation prompt that will hang and block the agent indefinitely.
- Run `skynet status` to see who is currently connected.
- Each workspace stores its data in `~/.skynet/<workspace-uuid>/data.db`.
- The workspace server exposes a REST API at `http://<host>:<port>/api/` for programmatic access.
