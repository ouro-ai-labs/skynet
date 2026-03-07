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

### List humans

```bash
skynet human list [--workspace <name-or-id>]
```

---

## Status

### Check workspace status

```bash
skynet status [--workspace <name-or-id>]
```

Shows connected members, registered agents, and registered humans.

---

## Typical Workflow

1. **Create a workspace**: `skynet workspace new --name my-project`
2. **Start the workspace**: `skynet workspace start my-project` (keep running)
3. **Create agents**: `skynet agent new --name backend --type claude-code --role "backend engineer"`
4. **Create a human**: `skynet human new --name alice`
5. **Check status**: `skynet status`

---

## Tips

- Run `skynet status` to see who is currently connected.
- Each workspace stores its data in `~/.skynet/<workspace-uuid>/data.db`.
- The workspace server exposes a REST API at `http://<host>:<port>/api/` for programmatic access.
