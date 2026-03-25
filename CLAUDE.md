# Skynet — Agent Instructions

This file defines the **operational workflow** for making changes in this repo (how to set up, run, test, build). Keep it short, specific, and executable; link to `docs/` for long explanations.

Note: `AGENTS.md` is a symlink to this file (`CLAUDE.md`) for compatibility with multiple agent/rules systems.

Prerequisites: Node.js 20+ and `pnpm` (https://pnpm.io/).

## Project Overview

Skynet is a multi-agent collaboration network where heterogeneous coding agents (Claude Code, Gemini CLI, Codex CLI, etc.) and humans communicate freely via an IM-style architecture. See `docs/architecture.md` for full design.

## Command Discovery (No Guessing)

**IMPORTANT**: Never assume a CLI flag or dev command exists.

- For skynet CLI flags: run `pnpm skynet --help`.
- For workspace commands: run `pnpm turbo --help` or check `turbo.json`.

## Core Workflow (Verify -> Explore -> Plan -> Implement -> Ship)

- **Verify**: always define how correctness will be checked (tests, expected output, smoke command).
- **Explore**: read/grep before editing; confirm where the behavior lives.
- **Plan**: for multi-file or unfamiliar areas, write a short step plan + test plan before changing code.
- **Implement**: make the smallest change that satisfies acceptance criteria; keep diffs reviewable.
- **Ship**: run checks + update PR summary/checklist.

Skip the explicit plan only when the change is truly tiny and local (e.g., typo, small refactor in one file).

## Quickstart (Local Dev)

```bash
pnpm install
pnpm build
pnpm test
```

## Monorepo Structure

This is a pnpm workspaces + turborepo monorepo. Packages live under `packages/`:

- `packages/protocol` — Message type definitions and serialization
- `packages/workspace` — WebSocket server, member management, message routing
- `packages/sdk` — Client SDK for connecting to the server
- `packages/agent-adapter` — Agent adapters (Claude Code, Gemini CLI, Codex CLI, generic)
- `packages/monitor` — Web monitoring dashboard (React + Vite)
- `packages/chat` — Chat TUI for human participation
- `packages/cli` — `skynet` CLI entry point

See `docs/architecture.md` for the full architecture and `docs/phases.md` for the implementation roadmap.

## Scoped Documentation (Read When Touching These Areas)

If you modify code under these paths, also read the matching docs first:

- `packages/protocol` → `docs/protocol.md` (message types, entity types, backward compatibility)
- `packages/workspace` → `docs/workspace.md` (WebSocket protocol, HTTP API, entity management)
- `packages/sdk` → `docs/usage.md` (client SDK usage, reconnection, error handling)
- `packages/agent-adapter` → `docs/adapter.md` (adapter contracts, CLI process management)
- `packages/cli` (skynet CLI behavior) → **must update both** `skills/skynet/SKILL.md` (agent skill) **and** `docs/cli.md` (CLI reference)
- Entity model → `docs/entities.md` (workspace, agent, human lifecycle)

## Language

All code, comments, commit messages, PR descriptions, and documentation must be written in **English**. No exceptions.

## TypeScript Conventions

- Strict mode enabled (`"strict": true` in tsconfig).
- Prefer `interface` over `type` for object shapes.
- No `any` — use `unknown` and narrow, or define proper types in `packages/protocol`.
- All cross-package types live in `packages/protocol`; other packages import from there.
- Use named exports; avoid default exports.

## Branching Workflow (Mandatory — No Exceptions)

**CRITICAL**: You MUST NOT commit or push directly to `main`. Every code change — no matter how small — must go through a git worktree + pull request workflow:

1. **Create a worktree** with a new branch: `git worktree add ../skynet-<branch-name> -b <branch-name>`
2. **Switch to the worktree directory** (`cd ../skynet-<branch-name>`) and do ALL development there.
3. Commit and push the branch, then **open a PR** to merge into `main`.
4. After the PR is merged, clean up: `git worktree remove ../skynet-<branch-name>`

**Prohibited actions on `main`**:
- `git commit` directly on `main`
- `git push` to `main` (including `git push origin main`)
- `git merge` into local `main`

If you find yourself on `main`, **stop and create a worktree first**.

## Testing Requirements

**MANDATORY**: Every code change must include corresponding unit test coverage.

- When adding new functionality, add unit tests that cover the happy path and key error cases.
- When modifying existing functionality, update the affected tests to reflect the new behavior.
- When fixing a bug, add a regression test that reproduces the issue before verifying the fix.
- Before committing, **always** run the full test suite: `pnpm build && pnpm test`. Do not commit if any test fails.
- Test files live alongside source code in `__tests__/` directories (e.g., `src/__tests__/foo.test.ts`).

## Checkpoint Commits

Prefer small, reviewable commits:
- Before committing, run `pnpm build && pnpm test`.
- Keep mechanical changes (formatting, renames) in their own commit when possible.
- **Human-in-the-loop**: at key checkpoints, the agent should *ask* whether to `git commit` and/or `git push` (do not do it automatically).
- Before asking to commit, show a short change summary (e.g. `git diff --stat`) and test results.

## Permissions / Approval Boundaries

Allowed without prompting:
- Read files, list directories, search.
- Run targeted unit tests or lint.

Require explicit confirmation first:
- Publishing or release actions.
- Git operations that change remote history (`git push`, opening PRs).
- Deleting large amounts of files or doing broad refactors/renames.
- Running commands that spawn external CLI agents (cost implications).

## Ship Checklist

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (when configured)
- [ ] PR description follows template

## PR Title Format (Required)

PR titles are used to auto-generate release notes. Use this format:

```
<type>(<scope>): <short description>
```

**Types** (pick one):

| Type       | When to use                                      |
| ---------- | ------------------------------------------------ |
| `feat`     | New user-facing feature                          |
| `fix`      | Bug fix                                          |
| `docs`     | Documentation only                               |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding or updating tests                         |
| `chore`    | Build, CI, dependency updates, or housekeeping   |
| `perf`     | Performance improvement                          |

**Scope** (optional): the package or area affected — e.g., `cli`, `chat`, `protocol`, `sdk`, `workspace`, `coordinator`, `adapter`, `monitor`.

**Examples**:

- `feat(chat): support image paste via Ctrl+V`
- `fix(workspace): handle reconnection race condition`
- `chore(ci): add release workflow`
- `docs: update architecture diagram`

**Rules**:

- Use lowercase; no trailing period.
- Keep it under 70 characters.
- Use imperative mood ("add", not "added" or "adds").

## PR Description Template (Required)

## Summary

What changed and why (user-facing when applicable).

## Scope

- Goals:
- Non-goals:

## Acceptance Criteria

- [ ] Concrete, testable outcomes

## Test Plan

- [ ] Targeted tests:
- [ ] `pnpm test`
- [ ] `pnpm build`

## Docs Pointers

- Architecture: `docs/architecture.md`
- Protocol design: `docs/protocol.md`
- Entity model: `docs/entities.md`
- Workspace server: `docs/workspace.md`
- Agent adapter: `docs/adapter.md`
- Usage guide: `docs/usage.md`
- Implementation phases: `docs/phases.md`

## Safety & Secrets

- Never commit API keys or tokens.
- Never commit `node_modules/`, `dist/`, or `.env` files.
- Avoid running destructive shell commands; keep file edits scoped and reversible.

## Gotchas (Common Rework Sources)

- **Cross-package imports**: always import types from `@skynet-ai/protocol`, not from another package's internal files.
- **WebSocket state**: handle reconnection and message ordering carefully; never assume the connection is stable.
- **Process management**: agent adapters spawn child processes; always handle cleanup on exit/crash (SIGINT, SIGTERM).
- **SQLite concurrency**: better-sqlite3 is synchronous; keep DB operations off the hot path or use worker threads.
