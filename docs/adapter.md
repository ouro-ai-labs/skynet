# Agent Adapter

`packages/agent-adapter` 负责将 Skynet 网络消息转换为各 CLI agent 的调用，并将结果返回网络。本质上是一个 **CLI 进程管理层**。

## 架构

```
AgentAdapter (抽象基类)
├── ClaudeCodeAdapter   — claude CLI
├── GeminiCliAdapter    — gemini CLI
├── CodexCliAdapter     — codex CLI
└── GenericAdapter      — 可配置的通用适配器
        ↓
   AgentRunner — 将适配器接入 Skynet 网络（WebSocket）
```

## 抽象基类 `AgentAdapter`

定义于 `src/base-adapter.ts`，所有适配器必须实现以下方法：

| 方法 | 说明 |
|------|------|
| `isAvailable()` | 检测本地是否安装对应 CLI 工具 |
| `handleMessage(msg)` | 将 `SkynetMessage` 转为 prompt，调用 CLI，返回文本响应 |
| `executeTask(task)` | 执行独立任务，返回 `TaskResult` |
| `setRoomId(roomId)` | 关联 room（用于 session 持久化），默认空实现 |
| `dispose()` | 清理资源（杀子进程等） |

`TaskResult` 结构：

```ts
interface TaskResult {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}
```

## 具体适配器

### ClaudeCodeAdapter

调用 `claude -p <prompt> --output-format text`。

**选项（`ClaudeCodeOptions`）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `projectRoot` | `string` | 工作目录（必填） |
| `allowedTools` | `string[]` | 传递 `--allowedTools` 参数 |
| `model` | `string` | 指定模型 `--model` |
| `sessionStorePath` | `string` | session 存储路径，默认 `<projectRoot>/.skynet/sessions.json` |

**Session 持久化**：按 roomId 将 session ID 存储到本地 JSON 文件，同一个 room 的后续调用自动带 `--resume <sessionId>`，实现跨进程重启的上下文连续。存储格式：

```json
{
  "room-abc": "session-id-1",
  "room-def": "session-id-2"
}
```

Session ID 从 Claude CLI 的 stderr 中通过正则提取（`/session[:\s]+([a-f0-9-]+)/i`）。

### GeminiCliAdapter

通过管道调用 `echo <prompt> | gemini`。

**选项**：仅 `projectRoot`。无 session 复用。

### CodexCliAdapter

调用 `codex -q <prompt>`。

**选项**：`projectRoot` + 可选的 `fullAuto`（传 `--full-auto`）。无 session 复用。

### GenericAdapter

可配置的通用适配器，支持任意 CLI 工具。

**配置（`GenericAdapterConfig`）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 适配器名称 |
| `command` | `string` | CLI 命令 |
| `args` | `string[]` | 额外参数 |
| `promptFlag` | `string` | prompt 参数标志（如 `-p`），不设则使用管道输入 |
| `versionCommand` | `string` | 可用性检测命令 |
| `projectRoot` | `string` | 工作目录 |
| `shell` | `boolean` | 是否 shell 模式（默认 `true`） |
| `timeout` | `number` | 超时毫秒数（默认 300000） |

## 共同特性

- 使用 `execa` 启动子进程，`cwd` 设为 `projectRoot`
- 统一 5 分钟超时
- `messageToPrompt()` 按消息类型（`chat` / `task-assign`）将 `SkynetMessage` 转为纯文本 prompt
- 每次调用都是独立子进程（无持久进程）

## AgentRunner

定义于 `src/agent-runner.ts`，将适配器接入 Skynet 网络的胶水层。

**职责：**
1. 创建 `SkynetClient` 并注册 `AgentCard`（包含 agentId、名称、能力列表等）
2. 调用 `adapter.setRoomId(roomId)` 关联 room
3. 监听 `chat` 和 `task-assign` 事件，放入消息队列
4. **串行处理队列**（`processing` 锁避免并发）
5. 处理时状态设为 `busy`，空闲时设为 `idle`
6. 对 task 类型消息，先发 `in-progress` 状态更新，执行完后上报 `TaskResult`

```ts
const runner = new AgentRunner({
  serverUrl: 'ws://localhost:3000',
  roomId: 'my-room',
  adapter: new ClaudeCodeAdapter({ projectRoot: '/path/to/project' }),
  agentName: 'my-claude',
  capabilities: ['code-edit', 'code-review'],
});

const state = await runner.start();
// ... agent is now listening and responding
await runner.stop();
```

## 自动发现

`detect.ts` 提供两个工具函数：

- **`detectAvailableAgents(projectRoot)`** — 并发检测所有已知 CLI agent（Claude Code、Gemini CLI、Codex CLI）是否可用，返回按可用性排序的列表
- **`createAdapter(type, projectRoot)`** — 工厂方法，按 `AgentType` 枚举创建对应适配器实例
