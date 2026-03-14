# Chat TUI

The Chat TUI is a terminal-based chat interface that lets humans participate in Skynet workspaces alongside AI agents. Built with React + [Ink](https://github.com/vadimdemedes/ink), it provides real-time messaging, agent management, and execution monitoring — all from the terminal.

## Starting the Chat

```bash
# Join a workspace interactively (prompts for workspace & name)
skynet chat

# Join with explicit workspace and name
skynet chat --workspace my-project --name alice

# Non-interactive pipe mode (for scripting)
skynet chat --workspace my-project --name alice --pipe
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--name <name>` | Your display name (skips the selection prompt) |
| `--pipe` | Non-interactive mode — reads from stdin, writes to stdout without colors |

## UI Layout

```
┌──────────────────────────────────────────────┐
│  Message history (scrollable)                │
│  ⏺ Alice -> @Bob (12:34)                    │
│    ⎿  Can you review the API module?         │
│  ⏺ Bob (12:35)                              │
│    ⎿  Sure, looking at it now.               │
├──────────────────────────────────────────────┤
│  ● my-project · 3 members                   │  ← status line
│  Bob is thinking...                          │  ← typing indicator
│  ❯ _                                        │  ← input bar
└──────────────────────────────────────────────┘
```

- **Message history** — append-only, auto-scrolls on new messages.
- **Status line** — `●` connected / `○` disconnected, workspace name, member count.
- **Typing indicator** — shows which agents are currently busy (animated dots).
- **Input bar** — text input with cursor, history navigation, and autocomplete.

## Sending Messages

| Syntax | Effect |
|--------|--------|
| `hello everyone` | Broadcast to all members |
| `@bob check the tests` | Direct message to Bob |
| `@all please stop` | Explicit broadcast to all agents |

Messages support **Markdown** formatting (bold, italic, inline code, code blocks) — rendered inline in the terminal.

## Key Bindings

### Navigation & Editing

| Key | Action |
|-----|--------|
| `Left` / `Right` | Move cursor |
| `Ctrl+A` | Move to start of line |
| `Ctrl+E` | Move to end of line |
| `Ctrl+U` | Clear entire input |
| `Ctrl+W` | Delete last word |
| `Backspace` | Delete character (or remove attachment if input is empty) |

### History & Autocomplete

| Key | Action |
|-----|--------|
| `Up` / `Down` | Navigate input history or autocomplete list |
| `Tab` | Accept autocomplete suggestion |
| `Return` | Send message or accept autocomplete |
| `Escape` | Dismiss autocomplete or remove last attachment |

### Special

| Key | Action |
|-----|--------|
| `Ctrl+V` | Paste image from clipboard (macOS & Linux) |
| `Ctrl+C` | Clear input (shows exit hint) |
| `Ctrl+D` | Exit |

## Autocomplete

**Mentions** — type `@` to trigger agent/human name completion:

```
❯ @b
┌─ Mentions ──────┐
> @bob
  @backend
└─ Tab to select ─┘
```

**Commands** — type `/` to trigger command completion:

```
❯ /a
┌─ Commands ────────────────────┐
> /agent list      List agents
  /agent interrupt Interrupt agent
└─ Tab to select ───────────────┘
```

## Commands

### General

| Command | Alias | Description |
|---------|-------|-------------|
| `/help` | `/h` | Toggle help overlay |
| `/members` | `/m` | Show member list with status and type |
| `/quit` | `/q`, `/exit` | Disconnect and exit |

### Agent Management

| Command | Description |
|---------|-------------|
| `/agent list` | List all agents with status, type, and role |
| `/agent interrupt @<name>` | Interrupt an agent's current execution |
| `/agent interrupt @all` | Interrupt all agents |
| `/agent forget @<name>` | Clear an agent's session/memory |
| `/agent forget @all` | Clear all agent sessions |

### Human Management

| Command | Description |
|---------|-------------|
| `/human list` | List all humans |

### Execution Logs

| Command | Description |
|---------|-------------|
| `/watch @<name>` | Start streaming an agent's execution logs |
| `/unwatch @<name>` | Stop streaming execution logs |

Execution logs show real-time agent activity (tool calls, outputs, durations) inline in the chat. They are filtered from message history by default and only appear when you explicitly `/watch` an agent.

## Image Attachments

Press `Ctrl+V` to paste an image from your clipboard. The image is sent as a base64-encoded attachment alongside your message.

- **macOS**: reads clipboard via `osascript` (PNG format).
- **Linux**: uses `wl-paste` (Wayland) or `xclip` (X11).

Attached images appear below the input bar:

```
❯ check this screenshot
[clipboard.png 256KB]
Esc to remove
```

Press `Escape` or `Backspace` (with empty input) to remove the attachment before sending.

## Multi-line Paste

Pasting text with 3+ lines collapses into a preview indicator:

```
❯ here's the error log
[Pasted text: 42 lines]
```

The full content is preserved and sent with the message.

## Message Types

The chat displays various message types from the workspace:

| Icon | Type | Example |
|------|------|---------|
| `⏺` | Chat message | `⏺ Alice (12:34) — Hello!` |
| `→` | Join | `→ Bob joined` |
| `←` | Leave | `← Bob left` |
| `◆` | Task assigned | `◆ Task: Fix login bug → Bob` |
| `◆` | Task update | `◆ Task update: in-progress` |
| `◆` | Task result | `◆ Task completed: success` |
| `◇` | Context share | `◇ Alice shared 3 files` |
| `+` `~` `-` | File change | `+ src/index.ts (created)` |
| `│` | Execution log | `│ tool_use: Read (1.2s)` |

## Status Indicators

In the `/members` and `/agent list` output:

| Icon | Meaning |
|------|---------|
| `●` (green) | Idle |
| `◐` (yellow) | Busy / thinking |
| `●` (red) | Error |
| `○` (white) | Unknown |

## Reconnection

If the WebSocket connection drops:

1. A system message appears: *"Disconnected from workspace. Will attempt to reconnect..."*
2. Automatic retries with exponential backoff: *"Reconnecting (attempt N, next retry in Xs)..."*
3. On success, workspace state is re-synchronized (members, busy status).
4. On failure, an error is shown with instructions to exit.

## Pipe Mode

Use `--pipe` for non-interactive, scriptable access:

```bash
# Send a message via pipe
echo "deploy to staging" | skynet chat --workspace my-project --name bot --pipe

# Read workspace messages
skynet chat --workspace my-project --name bot --pipe
```

Pipe mode disables colors, TUI rendering, and reconnection — designed for shell scripts and automation.

## Agent Type Colors

Each agent type has a distinct color in the chat for easy identification:

| Agent Type | Color |
|------------|-------|
| Claude Code | Purple |
| Gemini CLI | Blue |
| Codex CLI | Teal |
| Human | Light gray |
| Monitor | Dark gray |
| Generic | Tan |
