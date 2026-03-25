# Scheduler — Recurring Agent Tasks

`packages/workspace/src/scheduler.ts` — Cron-based scheduler that lets humans set up recurring tasks for agents via natural language in chat.

## How It Works

Humans `@mention` an agent and describe a recurring task in natural language. The agent (an LLM) understands the scheduling intent, converts it to a cron expression, and outputs a structured `<schedule-create />` XML tag. The agent runner parses the tag, calls the workspace schedule API, and the scheduler fires `TASK_ASSIGN` messages on each cron tick.

```
Human → @backend "每天早上9点帮我review PR"
                ↓
Agent (LLM) → understands intent, outputs <schedule-create ... />
                ↓
AgentRunner → parses XML tag, calls POST /api/schedules
                ↓
Scheduler → stores in SQLite, starts cron job
                ↓
Every day 09:00 → Scheduler fires TASK_ASSIGN → Agent executes task
```

The LLM agent is the natural language parser — no NLP library is needed.

## Architecture

```
┌──────────────────────────────────────────────┐
│            Workspace Server                  │
│                                              │
│  ┌────────────┐    ┌──────────────────────┐  │
│  │ Scheduler  │───▶│ Message Router       │  │
│  │ Service    │    │ (existing)           │  │
│  │            │    └──────────┬───────────┘  │
│  │ • croner   │         ┌─────┴─────┐        │
│  │ • SQLite   │         ▼           ▼        │
│  └────────────┘    Agent A      Agent B       │
└──────────────────────────────────────────────┘
```

- **Server-side scheduling**: the scheduler runs inside the workspace server, not inside agents. Schedule state is persisted in SQLite and survives server restarts.
- **Reuses existing message routing**: on each cron tick, the scheduler creates a standard `TASK_ASSIGN` message and routes it through the normal message delivery system.
- **Agent-offline handling**: if the target agent is offline when a cron tick fires, the message is persisted to SQLite. The agent picks it up when it reconnects (existing catch-up mechanism).

## Data Model

### `schedules` table (SQLite)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `name` | TEXT | Human-readable name |
| `cron_expr` | TEXT | Standard 5-field cron expression |
| `agent_id` | TEXT | Target agent UUID |
| `task_template` | TEXT (JSON) | `{ title, description, files?, metadata? }` |
| `enabled` | INTEGER | 0 = disabled, 1 = enabled |
| `created_by` | TEXT | Creator (human or agent ID) |
| `last_run_at` | INTEGER | Unix ms of last execution |
| `next_run_at` | INTEGER | Unix ms of next planned execution |
| `created_at` | INTEGER | Unix ms |
| `updated_at` | INTEGER | Unix ms |

### Protocol Types

Defined in `packages/protocol/src/types.ts`:

- **`ScheduleInfo`** — full schedule record (matches DB schema)
- **`ScheduleCreatePayload`** — fields required to create a schedule
- **`ScheduleUpdatePayload`** — partial update fields
- **`ScheduleDeletePayload`** — `{ scheduleId }`
- **`ScheduleListPayload`** — optional `{ agentId }` filter
- **`ScheduleTriggerPayload`** — sent when a cron tick fires

### Message Types

| MessageType | Description |
|-------------|-------------|
| `schedule.create` | Create a new schedule |
| `schedule.update` | Update an existing schedule |
| `schedule.delete` | Delete a schedule |
| `schedule.list` | List schedules |
| `schedule.trigger` | Cron tick fired — schedule executed |

## HTTP API

All routes are under the workspace server (default `http://localhost:4117`).

### `POST /api/schedules`

Create a new schedule.

**Request body:**

```json
{
  "name": "daily-review",
  "cronExpr": "0 9 * * *",
  "agentId": "agent-uuid",
  "taskTemplate": {
    "title": "Daily PR review",
    "description": "Review all open PRs from yesterday and summarize."
  },
  "createdBy": "human-uuid"
}
```

**Response:** `201` with `ScheduleInfo` object.

**Errors:**
- `400` — missing required fields or invalid cron expression
- `404` — agent not found

### `GET /api/schedules`

List all schedules. Optional query parameter `agentId` to filter by agent.

```
GET /api/schedules
GET /api/schedules?agentId=agent-uuid
```

**Response:** `200` with `ScheduleInfo[]`.

### `GET /api/schedules/:id`

Get a single schedule by ID.

**Response:** `200` with `ScheduleInfo`, or `404`.

### `PATCH /api/schedules/:id`

Update a schedule. All fields are optional.

```json
{
  "name": "new-name",
  "cronExpr": "0 17 * * 1-5",
  "enabled": false
}
```

**Response:** `200` with updated `ScheduleInfo`, or `404`.

### `DELETE /api/schedules/:id`

Delete a schedule.

**Response:** `200` with `{ deleted: true }`, or `404`.

## Agent XML Tags

Agents create, delete, and list schedules by outputting XML tags in their response. The `AgentRunner` intercepts these tags, executes the corresponding API calls, and strips them from the chat output.

### `<schedule-create />`

```xml
<schedule-create
  name="daily-review"
  cron="0 9 * * *"
  agent="@backend"
  title="Daily PR review"
  description="Review all open PRs from yesterday and summarize findings."
/>
```

| Attribute | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Human-readable schedule name |
| `cron` | Yes | 5-field cron expression |
| `agent` | Yes | Target agent @name (or name without @) |
| `title` | Yes | Task title sent on each tick |
| `description` | Yes | Task description sent on each tick |

### `<schedule-delete />`

```xml
<schedule-delete id="schedule-uuid" />
```

### `<schedule-list />`

```xml
<schedule-list />
```

The agent runner resolves `@name` to agent UUIDs using the workspace member list.

## SDK Client Methods

`SkynetClient` (`packages/sdk/src/client.ts`) provides HTTP methods for schedule management:

```typescript
// Create
const schedule = await client.createSchedule({
  name: 'daily-review',
  cronExpr: '0 9 * * *',
  agentId: 'agent-uuid',
  taskTemplate: { title: 'Review PRs', description: '...' },
});

// List (optionally filter by agent)
const all = await client.listSchedules();
const mine = await client.listSchedules('agent-uuid');

// Get
const schedule = await client.getSchedule('schedule-uuid');

// Update
const updated = await client.updateSchedule('schedule-uuid', {
  cronExpr: '0 17 * * 1-5',
  enabled: false,
});

// Delete
await client.deleteSchedule('schedule-uuid');
```

## CLI Commands

Admin/debug commands for managing schedules. The primary interface for creating schedules is natural language via chat.

### `skynet schedule list`

```bash
skynet schedule list --workspace <name-or-id>
skynet schedule list --workspace <name-or-id> --agent <agent-id>
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--agent <agent-id>` | Filter by agent ID (optional) |

### `skynet schedule delete <id>`

```bash
skynet schedule delete <schedule-id> --workspace <name-or-id>
skynet schedule delete <schedule-id> --workspace <name-or-id> --force
```

| Flag | Description |
|------|-------------|
| `--workspace <name-or-id>` | Workspace name or UUID |
| `--force` | Skip confirmation prompt |

### `skynet schedule enable <id>`

```bash
skynet schedule enable <schedule-id> --workspace <name-or-id>
```

### `skynet schedule disable <id>`

```bash
skynet schedule disable <schedule-id> --workspace <name-or-id>
```

## Cron Expression Reference

Standard 5-field format: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | Every day at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 17 * * 1-5` | Weekdays at 5:00 PM |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 9,17 * * *` | Every day at 9:00 AM and 5:00 PM |

Powered by [croner](https://github.com/hexagon/croner) — zero-dependency, ESM, supports second-level precision.

## Examples

### Natural Language → Schedule

| Human says | Agent creates |
|------------|---------------|
| "每天早上9点帮我review PR" | `cron="0 9 * * *"` |
| "每半小时检查一下CI状态" | `cron="*/30 * * * *"` |
| "周一到周五下午5点总结今天的改动" | `cron="0 17 * * 1-5"` |
| "取消那个CI检查的定时任务" | `<schedule-delete id="..." />` |
| "现在有哪些定时任务？" | `<schedule-list />` |

### Full Chat Flow

```
Alice:   @backend 每天早上9点帮我review一下昨天的PR
backend: 好的，已设置每天 9:00 自动执行 PR review。

... next day, 09:00 ...

backend: [receives TASK_ASSIGN from scheduler]
backend: @alice 昨天有3个PR需要关注：
         1. #142 — 新增用户认证模块，代码质量良好，建议合入
         2. #143 — 重构数据库层，有几个潜在的并发问题需要讨论
         3. #144 — 文档更新，LGTM
```

## File Structure

```
packages/workspace/src/
  scheduler.ts                          # Scheduler service (croner + SQLite)
  server.ts                             # Schedule HTTP routes (registerScheduleRoutes)
  sqlite-store.ts                       # Schedule CRUD (schedules table)
  store.ts                              # Store interface (schedule methods)
  __tests__/scheduler.test.ts           # Scheduler unit tests
  __tests__/sqlite-store-schedules.test.ts  # Store schedule tests

packages/agent-adapter/src/
  schedule-parser.ts                    # XML tag parser (<schedule-create/delete/list />)
  agent-runner.ts                       # processResponse() — intercepts schedule tags
  skynet-intro.ts                       # System prompt — teaches agents schedule syntax
  __tests__/schedule-parser.test.ts     # Parser unit tests

packages/protocol/src/
  types.ts                              # ScheduleInfo, ScheduleCreatePayload, MessageType.SCHEDULE_*

packages/sdk/src/
  client.ts                             # HTTP methods: createSchedule, listSchedules, etc.

packages/cli/src/commands/
  schedule.ts                           # skynet schedule list/delete/enable/disable
```
