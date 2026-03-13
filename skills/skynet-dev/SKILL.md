---
name: skynet-dev
description: Manage the Skynet multi-agent collaboration network using the local dev CLI (pnpm skynet). Use when developing and testing Skynet locally.
---

# Skynet Management Skill (Development)

You can manage the Skynet multi-agent collaboration network using the local dev CLI. All commands below are non-interactive (pass all options as flags) so you can run them directly via your shell tool.

**Prerequisites**: From the Skynet repo root, run `pnpm install && pnpm build` first.

> **Note**: All commands use `pnpm skynet` instead of `skynet`. This runs the locally built CLI.

---

## Workspace Management

### Create a workspace

```bash
pnpm skynet workspace new --name <workspace-name> [--host <host>] [--port <port>]
```

- `--name` (required): Human-readable workspace name
- `--host` (optional): Bind address, default `0.0.0.0`
- `--port` (optional): Port number, default `4117`

### List workspaces

```bash
pnpm skynet workspace list
```

### Delete a workspace

```bash
pnpm skynet workspace delete <workspace-uuid> --force
```

Removes the workspace from the registry and deletes all its data (agents, messages, config).

### Start a workspace (daemon)

```bash
pnpm skynet workspace start <name-or-id> -d
```

### Stop a workspace

```bash
pnpm skynet workspace stop <name-or-id>
```

### Check workspace daemon status

```bash
pnpm skynet workspace status <name-or-id>
```

### View workspace logs

```bash
pnpm skynet workspace logs <name-or-id>
```

---

## Agent Management

All agent commands require a running workspace. Use `--workspace <name-or-id>` if you have multiple workspaces.

### Create an agent

```bash
pnpm skynet agent new --name <agent-name> --type <agent-type> [--role <role>] [--persona <persona>] [--workdir <path>] [--skills <spec...>] [--workspace <name-or-id>]
```

- `--name` (required): Agent display name
- `--type` (required): One of `claude-code`, `gemini-cli`, `codex-cli`, `generic`
- `--role` (optional): Agent's role description (e.g., "backend engineer")
- `--persona` (optional): Persona description for the agent's behavior
- `--workdir` (optional): Custom working directory (default: `~/.skynet/<ws>/<id>/work`)
- `--skills` (optional, repeatable): Install skills into the agent's working directory via `npx skills add`. Format: `source[:skill-name]`. Can be specified multiple times (e.g., `--skills github.com/org/repo --skills ./local-skill:my-skill`)

**Working directory prompt**: If the user does not explicitly specify `--workdir`, you **must** ask the user before running the command:

> The agent's working directory determines where it reads/writes files. Would you like to:
> 1. Specify a custom working directory (e.g., a project repo path)
> 2. Use the default (`~/.skynet/<ws>/<id>/work`)

If the user chooses a custom path, pass it via `--workdir <path>`. If they choose the default, omit `--workdir`.

**Finding skills**: If the user wants to create an agent with a particular skill but does not provide a specific skill source/path, search for it first:

```bash
npx skills find <query>
```

Review the search results with the user and confirm which skill to use before passing it to `--skills`.

### Start an agent

```bash
pnpm skynet agent start <agent-name-or-id> [--workspace <name-or-id>]
```

Connects the agent to the workspace and starts processing messages as a background daemon (default). Use `-f` to run in foreground instead.

### Stop an agent

```bash
pnpm skynet agent stop <agent-name-or-id> [--workspace <name-or-id>]
```

### Check agent daemon status

```bash
pnpm skynet agent status <agent-name-or-id> [--workspace <name-or-id>]
```

### View agent logs

```bash
pnpm skynet agent logs <agent-name-or-id> [--workspace <name-or-id>]
```

### Delete an agent

```bash
pnpm skynet agent delete <agent-uuid> --force [--workspace <name-or-id>]
```

Deletes the agent from the workspace. Fails if the agent is currently connected.

### Interrupt an agent

```bash
pnpm skynet agent interrupt <agent-name-or-id> [--workspace <name-or-id>]
```

Interrupts the agent's currently running task (equivalent to `Ctrl+C`). The agent remains connected and can receive new tasks.

### Reset an agent's session (forget)

```bash
pnpm skynet agent forget <agent-name-or-id> [--workspace <name-or-id>]
```

Clears the agent's conversation history so it starts fresh. Useful when reassigning an agent to an unrelated task.

### List agents

```bash
pnpm skynet agent list [--workspace <name-or-id>]
```

---

## Human Management

### Create a human

```bash
pnpm skynet human new --name <human-name> [--workspace <name-or-id>]
```

### Delete a human

```bash
pnpm skynet human delete <human-uuid> --force [--workspace <name-or-id>]
```

Deletes the human from the workspace. Fails if the human is currently connected.

### List humans

```bash
pnpm skynet human list [--workspace <name-or-id>]
```

---

## Chat (Human Only)

> **Do NOT run this command yourself.** `pnpm skynet chat` launches an interactive TUI for humans to join the workspace. When you need a human to join, tell them to run this command in a separate terminal.

```bash
pnpm skynet chat [--name <human-name>] [--workspace <name-or-id>]
```

- `--name` (optional): Human name to join as (skips selection prompt)
- If only one human is registered, it is auto-selected.

---

## Status

### Check workspace status

```bash
pnpm skynet status [--workspace <name-or-id>]
```

Shows all registered agents and humans with their id, name, role, persona, and online status.

---

## Typical Workflow

1. **Build**: `pnpm install && pnpm build`
2. **Create a workspace**: `pnpm skynet workspace new --name my-project`
3. **Start the workspace**: `pnpm skynet workspace start my-project -d`
4. **Create agents**: `pnpm skynet agent new --name backend --type claude-code --role "backend engineer"`
5. **Start the agent**: `pnpm skynet agent start backend`
6. **Create a human**: `pnpm skynet human new --name alice`
7. **Human joins chat** (tell them to run): `pnpm skynet chat --name alice`
8. **Check status**: `pnpm skynet status`
9. **Stop when done**: `pnpm skynet agent stop backend && pnpm skynet workspace stop my-project`

---

## Logs

All runtime logs are written to `~/.skynet/<workspace-uuid>/logs/`:

- **Server log**: `~/.skynet/<workspace-uuid>/logs/server.log`
- **Agent logs**: `~/.skynet/<workspace-uuid>/logs/<agent-uuid>.log`

---

## Tips

- **CRITICAL**: When deleting workspaces, agents, or humans, you **MUST** always pass `--force`. Without `--force`, the command enters an interactive confirmation prompt that will hang and block the agent indefinitely.
- Run `pnpm skynet status` to see who is currently connected.
- Each workspace stores its data in `~/.skynet/<workspace-uuid>/data.db`.
- The workspace server exposes a REST API at `http://<host>:<port>/api/` for programmatic access.
