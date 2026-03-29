import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { execa, execaCommand, type ResultPromise } from 'execa';
import { AgentType, type SkynetMessage, type ChatPayload, type TaskPayload, MessageType } from '@skynet-ai/protocol';
import { AgentAdapter, type TaskResult, type SessionState } from '../base-adapter.js';

export interface CodexCliOptions {
  projectRoot: string;
  fullAuto?: boolean;
  model?: string;
}

/**
 * Sanitize execa errors to avoid leaking the full command line
 * (which may include system prompts) when errors are broadcast.
 */
function sanitizeExecaError(err: unknown): Error {
  if (err instanceof Error) {
    const errRecord = err as unknown as Record<string, unknown>;
    const shortMessage = errRecord.shortMessage as string | undefined;
    const stderr = (errRecord.stderrOutput as string | undefined)
      ?? (typeof errRecord.stderr === 'string' && errRecord.stderr ? errRecord.stderr : undefined);
    if (shortMessage) {
      const msg = stderr ? `${shortMessage}: ${stderr}` : shortMessage;
      const sanitized = new Error(msg);
      sanitized.name = err.name;
      return sanitized;
    }
    const exitCode = errRecord.exitCode as number | undefined;
    if (exitCode !== undefined || stderr) {
      const parts: string[] = [];
      parts.push(exitCode !== undefined ? `Command failed with exit code ${exitCode}` : 'Command failed');
      if (stderr) parts.push(stderr);
      const sanitized = new Error(parts.join(': '));
      sanitized.name = err.name;
      return sanitized;
    }
    return err;
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Adapter for the Codex CLI (https://github.com/openai/codex).
 *
 * Uses `codex exec` in non-interactive mode with `--json` for structured JSONL
 * output. Supports session management via `codex exec resume <thread-id>`.
 *
 * JSONL event types:
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"item.started","item":{"type":"command_execution","command":"...","status":"in_progress"}}
 *   {"type":"item.completed","item":{"type":"command_execution","command":"...","exit_code":0,"status":"completed"}}
 *   {"type":"turn.completed","usage":{...}}
 */
export class CodexCliAdapter extends AgentAdapter {
  readonly type = AgentType.CODEX_CLI;
  readonly name = 'codex-cli';
  private projectRoot: string;
  private fullAuto: boolean;
  private model?: string;
  private sessionId: string = randomUUID();
  private threadId: string | null = null;
  private sessionStarted = false;
  /** Track the currently running child process for interrupt support. */
  private runningProcess: ResultPromise | null = null;

  constructor(options: CodexCliOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.fullAuto = options.fullAuto ?? false;
    this.model = options.model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execaCommand('codex --version');
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(msg: SkynetMessage, senderName?: string, notices?: string): Promise<string> {
    const body = this.messageToPrompt(msg, senderName);
    const prompt = notices ? `${notices}\n\n${body}` : body;
    this.onPrompt?.(prompt, { type: 'message' });
    return this.runCodex(prompt);
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    const prompt = `Task: ${task.title}\n\nDescription: ${task.description}${
      task.files?.length ? `\n\nRelevant files: ${task.files.join(', ')}` : ''
    }`;
    this.onPrompt?.(prompt, { type: 'task' });

    try {
      const output = await this.runCodex(prompt);
      return {
        success: true,
        summary: output,
      };
    } catch (err) {
      return {
        success: false,
        summary: 'Task execution failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  override async interrupt(): Promise<boolean> {
    if (this.runningProcess) {
      this.runningProcess.kill('SIGTERM');
      this.runningProcess = null;
      return true;
    }
    return false;
  }

  override async resetSession(): Promise<void> {
    await this.interrupt();
    this.sessionId = randomUUID();
    this.threadId = null;
    this.sessionStarted = false;
  }

  override getSessionState(): SessionState {
    return {
      sessionId: this.threadId ?? this.sessionId,
      sessionStarted: this.sessionStarted,
    };
  }

  override restoreSessionState(state: SessionState): void {
    this.sessionId = state.sessionId;
    this.sessionStarted = state.sessionStarted;
    if (state.sessionStarted) {
      this.threadId = state.sessionId;
    }
  }

  async dispose(): Promise<void> {
    await this.interrupt();
  }

  private messageToPrompt(msg: SkynetMessage, senderName?: string): string {
    const sender = senderName ?? msg.from;
    switch (msg.type) {
      case MessageType.CHAT: {
        const payload = msg.payload as ChatPayload;
        return `Message from ${sender}: ${payload.text}`;
      }
      case MessageType.TASK_ASSIGN: {
        const payload = msg.payload as TaskPayload;
        return `Task assigned: ${payload.title}\n\n${payload.description}`;
      }
      default:
        return `Received ${msg.type} from ${sender}: ${JSON.stringify(msg.payload)}`;
    }
  }

  private async runCodex(prompt: string): Promise<string> {
    let fullPrompt = prompt;
    if (this.persona) {
      fullPrompt = `${this.persona}\n\n${prompt}`;
    }

    let args: string[];
    if (this.sessionStarted && this.threadId) {
      // Resume existing session
      args = ['exec', 'resume', this.threadId, '--json'];
      this.appendPermissionFlags(args);
      if (this.model) {
        args.push('-m', this.model);
      }
      args.push(fullPrompt);
    } else {
      // First call: new session
      args = ['exec', '--json'];
      this.appendPermissionFlags(args);
      args.push('-C', this.projectRoot);
      if (this.model) {
        args.push('-m', this.model);
      }
      args.push(fullPrompt);
    }

    const isFirstCall = !this.sessionStarted;
    const sessionIdAtStart = this.sessionId;
    const proc = execa('codex', args, {
      cwd: this.projectRoot,
      stdin: 'ignore',
      timeout: 0,
    });
    this.runningProcess = proc;

    // Collect stderr for error diagnostics
    const stderrChunks: string[] = [];
    if (proc.stderr) {
      const stderrRl = createInterface({ input: proc.stderr as unknown as NodeJS.ReadableStream });
      (async () => {
        for await (const line of stderrRl) {
          stderrChunks.push(line);
        }
      })().catch(() => {});
    }

    try {
      const { text, threadId } = await this.parseJsonl(proc);
      this.runningProcess = null;

      if (this.sessionId === sessionIdAtStart) {
        this.sessionStarted = true;
        if (threadId) {
          this.threadId = threadId;
        }
      }

      return text;
    } catch (err) {
      this.runningProcess = null;
      if (isFirstCall && this.sessionId === sessionIdAtStart) {
        this.sessionStarted = true;
      }
      if (stderrChunks.length > 0 && err instanceof Error) {
        (err as unknown as Record<string, unknown>).stderrOutput = stderrChunks.join('\n');
      }
      throw sanitizeExecaError(err);
    }
  }

  private appendPermissionFlags(args: string[]): void {
    if (this.fullAuto) {
      args.push('--full-auto');
    } else {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
  }

  /**
   * Parse JSONL output from `codex exec --json`.
   *
   * Events:
   *   thread.started  — contains thread_id for session resume
   *   item.completed  — agent_message (text) or command_execution (tool use)
   *   item.started    — command_execution in progress (emit tool.call log)
   *   turn.completed  — end of turn with usage stats
   */
  private async parseJsonl(proc: ResultPromise): Promise<{ text: string; threadId: string | null }> {
    const textParts: string[] = [];
    let threadId: string | null = null;

    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout as unknown as NodeJS.ReadableStream });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;

          if (event.type === 'thread.started') {
            threadId = (event.thread_id as string) ?? null;
          } else if (event.type === 'item.completed') {
            const item = event.item as Record<string, unknown> | undefined;
            if (!item) continue;

            if (item.type === 'agent_message') {
              const text = item.text as string | undefined;
              if (text) textParts.push(text);
            } else if (item.type === 'command_execution' && this.onExecutionLog) {
              const command = item.command as string | undefined;
              const exitCode = item.exit_code as number | undefined;
              const summary = command
                ? command.length > 80 ? command.slice(0, 80) + '…' : command
                : 'command';
              this.onExecutionLog('tool.result', `${summary} (exit ${exitCode ?? '?'})`);
            }
          } else if (event.type === 'item.started') {
            const item = event.item as Record<string, unknown> | undefined;
            if (!item) continue;

            if (item.type === 'command_execution' && this.onExecutionLog) {
              const command = item.command as string | undefined;
              const summary = command
                ? command.length > 80 ? command.slice(0, 80) + '…' : command
                : 'command';
              this.onExecutionLog('tool.call', summary);
            }
          }
        } catch {
          // Not valid JSON — accumulate as raw text
          textParts.push(line);
        }
      }
    }

    // Wait for process exit. Codex may leave child processes running; apply
    // the same kill-timer pattern as ClaudeCodeAdapter.
    const EXIT_TIMEOUT_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    if (proc.exitCode === null) {
      killTimer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, EXIT_TIMEOUT_MS);
    }
    try {
      await proc;
    } catch (err) {
      if (textParts.length > 0) {
        return { text: textParts.join('\n'), threadId };
      }
      throw err;
    } finally {
      if (killTimer) clearTimeout(killTimer);
    }

    return { text: textParts.join('\n'), threadId };
  }
}
