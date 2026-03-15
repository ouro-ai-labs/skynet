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
│  ● workspace · 3 members                    │  ← status line
│  Bob is thinking...                          │  ← typing indicator
│  ❯ _                                        │  ← input bar
└──────────────────────────────────────────────┘
```

- **Message history** — append-only, auto-scrolls on new messages.
- **Status line** — `●` connected / `○` disconnected, the literal word "workspace", member count.
- **Typing indicator** — shows which agents are currently busy, with an animated ellipsis that cycles through 1 to 3 dots every 500ms.
- **Input bar** — text input with cursor, history navigation, and autocomplete.

### Typing Indicator Formats

The indicator adjusts its label based on how many agents are busy:

| Busy agents | Display |
|-------------|---------|
| 1 | `Bob is thinking...` |
| 2 | `Alice and Bob are thinking...` |
| 3+ | `Alice and 2 others are thinking...` |

The trailing dots animate (`.` -> `..` -> `...` -> `.` ...) on a 500ms interval.

## Sending Messages

| Syntax | Effect |
|--------|--------|
| `hello everyone` | Broadcast to all members |
| `@bob check the tests` | Direct message to Bob |
| `@all please stop` | Broadcast to all agents (`@all` is a special mention target) |

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
| `Backspace` | Delete character (or remove attachment/pasted block if input is empty) |

### History & Autocomplete

| Key | Action |
|-----|--------|
| `Up` / `Down` | Navigate input history or autocomplete list |
| `Tab` | Accept autocomplete suggestion |
| `Return` | Send message or accept autocomplete |
| `Escape` | Dismiss autocomplete or remove last attachment/pasted block |

### Special

| Key | Action |
|-----|--------|
| `Ctrl+V` | Paste image from clipboard (macOS & Linux) |
| `Ctrl+C` | Clear input (shows exit hint) |
| `Ctrl+D` | Exit |

## Autocomplete

**Mentions** — type `@` to trigger agent/human name completion. The candidate list includes `@all` as a special broadcast target:

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
| `/quit` | `/q` | Disconnect and exit |

`/exit` also works as an alias for `/quit`, but it is not shown in the help overlay or autocomplete list.

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

Execution logs show real-time agent activity (tool calls, outputs, durations) inline in the chat. They are **filtered from initial message history** when you first connect — the history load skips all `EXECUTION_LOG` messages. Logs only appear in real time when you explicitly `/watch` an agent.

## Image Attachments

Press `Ctrl+V` to paste an image from your clipboard. The image is sent as a base64-encoded attachment alongside your message.

While the clipboard is being read, a status message appears below the input:

| Status | Meaning |
|--------|---------|
| `Reading clipboard...` | Clipboard read in progress |
| `No image in clipboard` | Clipboard did not contain image data (clears after 2s) |
| `Image too large: NKB (max NKB)` | Image exceeds size limit (clears after 3s) |
| `Paste failed` | Unexpected error (clears after 3s) |

### Platform Support

- **macOS**: reads clipboard via `osascript`, extracting PNG data from `clipboard info`. Checks for PNGf/TIFF/JPEG content types.
- **Linux (Wayland)**: uses `wl-paste --list-types` to check for `image/png`, then `wl-paste --type image/png` to extract.
- **Linux (X11)**: falls back to `xclip -selection clipboard -t image/png -o`. Tries Wayland first, then X11.
- **Windows**: not supported — `Ctrl+V` silently returns no image.

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

The chat displays various message types from the workspace. All message types use the same `⏺` marker, colored according to the sender's agent type:

| Icon | Type | Example |
|------|------|---------|
| `⏺` | Chat message | `⏺ Alice (12:34)` / `⎿  Hello!` |
| `⏺` | Join | `⏺ system` / `⎿  Bob Claude joined` |
| `⏺` | Leave | `⏺ system` / `⎿  Bob left` |
| `⏺` | Task assigned | `⏺ Alice (12:34)` / `⎿  ◆ task: Fix login bug -> Bob` |
| `⏺` | Task update | `⏺ Alice (12:34)` / `⎿  ◆ task abc12345 -> in-progress` |
| `⏺` | Task result | `⏺ Alice (12:34)` / `⎿  ◆ result [OK] summary` |
| `⏺` | Context share | `⏺ Alice (12:34)` / `⎿  ◇ shared 3 file(s)` |
| `⏺` | File change | `⏺ Bob (12:34)` / `⎿  + src/index.ts` |
| `│` | Execution log | `│ Bob [tool_use] Read file (1200ms) (12:34)` |

Join and leave messages display as system messages with the `⏺` marker colored to match the joining/leaving agent's type. Join messages also include the agent type label (e.g. "Claude", "Gemini").

Execution logs use a distinct `│` prefix with the agent name inline, followed by the event tag in brackets, a summary, and optional duration in parentheses.

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

Pipe mode differs from the interactive TUI in several ways:

- **No colors** — ANSI color output is disabled (`chalk.level = 0`) for clean piped output.
- **No TUI rendering** — messages are written directly to stdout as plain text, one per line.
- **No reconnection** — the client connects once with `reconnect: false`. If the connection drops, it writes an error to stderr and exits with code 1.
- **Execution logs filtered** — `EXECUTION_LOG` messages are silently skipped in both initial history and live message streams.
- **Slash commands supported** — lines starting with `/` are dispatched to the same command handler as the TUI (e.g. `/agent list`, `/watch @agent`). Command output goes to stdout; errors are prefixed with `[ERROR]`.
- **stdin EOF** — when stdin closes, the client disconnects cleanly and the process exits.

Errors (connection failures, disconnects) are written to stderr, not stdout.

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
