---
name: skynet
description: Manage the Skynet multi-agent collaboration network using the skynet CLI. Use when creating or managing workspaces, agents, humans, or checking system status.
---

# Skynet Management Skill

You can manage the Skynet multi-agent collaboration network using the `skynet` CLI. All commands below are non-interactive (pass all options as flags) so you can run them directly via your shell tool.

**Prerequisites**: The `skynet` CLI must be installed. In the Skynet repo, run `pnpm install && pnpm build` first.

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
# Start by name or UUID
skynet workspace start <name-or-id>

# If only one workspace exists, just run:
skynet workspace start
```

> Note: This is a long-running process. Run it in the background or in a separate terminal.

---

## Agent Management

All agent commands require a running workspace. Use `--workspace <name-or-id>` if you have multiple workspaces.

### Create an agent

```bash
skynet agent new --name <agent-name> --type <agent-type> [--role <role>] [--persona <persona>] [--workspace <name-or-id>]
```

- `--name` (required): Agent display name
- `--type` (required): One of `claude-code`, `gemini-cli`, `codex-cli`, `generic`
- `--role` (optional): Agent's role description (e.g., "backend engineer")
- `--persona` (optional): Persona description for the agent's behavior

### Start an agent

```bash
skynet agent start <agent-name-or-id> [--workspace <name-or-id>]
```

Connects the agent to the workspace and starts processing messages. This is a long-running process — run it in the background or in a separate terminal. Press `Ctrl+C` to disconnect.

### Delete an agent

```bash
skynet agent delete <agent-uuid> --force [--workspace <name-or-id>]
```

Deletes the agent from the workspace. Fails if the agent is currently connected.

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
2. **Start the workspace**: `skynet workspace start my-project` (keep running)
3. **Create agents**: `skynet agent new --name backend --type claude-code --role "backend engineer"`
4. **Start the agent**: `skynet agent start backend` (keep running)
5. **Create a human**: `skynet human new --name alice`
6. **Human joins chat** (tell them to run): `skynet chat --name alice`
7. **Check status**: `skynet status`

---

## Logs

All runtime logs are written to `~/.skynet/<workspace-uuid>/logs/`:

- **Server log**: `~/.skynet/<workspace-uuid>/logs/server.log`
- **Agent logs**: `~/.skynet/<workspace-uuid>/logs/<agent-uuid>.log`

---

## Tips

- Run `skynet status` to see who is currently connected.
- Each workspace stores its data in `~/.skynet/<workspace-uuid>/data.db`.
- The workspace server exposes a REST API at `http://<host>:<port>/api/` for programmatic access.
