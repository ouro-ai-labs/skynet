import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { execa, execaCommand, type ResultPromise } from 'execa';
import { AgentType, type SkynetMessage, type ChatPayload, type TaskPayload, MessageType } from '@skynet-ai/protocol';
import { AgentAdapter, type TaskResult, type SessionState } from '../base-adapter.js';

export interface OpenCodeOptions {
  projectRoot: string;
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
 * Adapter for the OpenCode CLI (https://github.com/opencode-ai/opencode).
 *
 * Uses `opencode run` in non-interactive mode with `--format json` for
 * structured output. Supports session management via `--session` / `--continue`
 * / `--fork` flags.
 */
export class OpenCodeAdapter extends AgentAdapter {
  readonly type = AgentType.OPENCODE;
  readonly name = 'opencode';
  private projectRoot: string;
  private model?: string;
  private sessionId: string = randomUUID();
  private sessionStarted = false;
  /** Track the currently running child process for interrupt support. */
  private runningProcess: ResultPromise | null = null;

  constructor(options: OpenCodeOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.model = options.model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execaCommand('opencode --version');
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(msg: SkynetMessage, senderName?: string, notices?: string): Promise<string> {
    const body = this.messageToPrompt(msg, senderName);
    const prompt = notices ? `${notices}\n\n${body}` : body;
    this.onPrompt?.(prompt, { type: 'message' });
    return this.runOpenCode(prompt);
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    const prompt = `Task: ${task.title}\n\nDescription: ${task.description}${
      task.files?.length ? `\n\nRelevant files: ${task.files.join(', ')}` : ''
    }`;
    this.onPrompt?.(prompt, { type: 'task' });

    try {
      const output = await this.runOpenCode(prompt);
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

  override supportsQuickReply(): boolean {
    return this.sessionStarted;
  }

  override async quickReply(prompt: string): Promise<string> {
    this.onPrompt?.(prompt, { type: 'quick-reply' });
    const args = [
      'run',
      '--format', 'text',
      '--session', this.sessionId,
      '--fork',
      prompt,
    ];

    if (this.model) {
      args.splice(1, 0, '--model', this.model);
    }

    try {
      const result = await execa('opencode', args, {
        cwd: this.projectRoot,
        stdin: 'ignore',
        timeout: 0,
      });
      return result.stdout;
    } catch (err) {
      throw sanitizeExecaError(err);
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
    this.sessionStarted = false;
  }

  override getSessionState(): SessionState {
    return {
      sessionId: this.sessionId,
      sessionStarted: this.sessionStarted,
    };
  }

  override restoreSessionState(state: SessionState): void {
    this.sessionId = state.sessionId;
    this.sessionStarted = state.sessionStarted;
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

  private async runOpenCode(prompt: string): Promise<string> {
    // Build persona-injected prompt: opencode doesn't have a system prompt flag,
    // so we prepend the persona to the user prompt (same approach as GenericAdapter).
    let fullPrompt = prompt;
    if (this.persona) {
      fullPrompt = `${this.persona}\n\n${prompt}`;
    }

    const args = ['run', '--format', 'json'];

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this.sessionStarted) {
      // Continue existing session
      args.push('--session', this.sessionId, '--continue');
    }
    // Note: opencode auto-creates sessions; we track via sessionStarted flag

    args.push(fullPrompt);

    const isFirstCall = !this.sessionStarted;
    const sessionIdAtStart = this.sessionId;
    const proc = execa('opencode', args, {
      cwd: this.projectRoot,
      stdin: 'ignore',
      timeout: 0, // no timeout — let the agent run until done
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
      const result = await proc;
      this.runningProcess = null;

      // Only update state if the session hasn't been reset while we were awaiting.
      if (this.sessionId === sessionIdAtStart) {
        this.sessionStarted = true;
      }

      // Try to parse JSON output and extract the response text
      const text = this.parseOutput(result.stdout);
      return text;
    } catch (err) {
      this.runningProcess = null;
      // Mark session as started even on failure (same rationale as ClaudeCodeAdapter)
      if (isFirstCall && this.sessionId === sessionIdAtStart) {
        this.sessionStarted = true;
      }
      // Attach stderr for diagnostics
      if (stderrChunks.length > 0 && err instanceof Error) {
        (err as unknown as Record<string, unknown>).stderrOutput = stderrChunks.join('\n');
      }
      throw sanitizeExecaError(err);
    }
  }

  /**
   * Parse the JSONL output from `opencode run --format json`.
   *
   * The output is newline-delimited JSON events:
   *   {"type":"step_start", ...}
   *   {"type":"text", "part": {"type":"text", "text":"response content"}, ...}
   *   {"type":"tool_call", "part": {"type":"tool-call", "name":"...", ...}, ...}
   *   {"type":"tool_result", "part": {"type":"tool-result", ...}, ...}
   *   {"type":"step_finish", ...}
   *
   * We extract `part.text` from all "text" events and concatenate them.
   * We also emit execution log events for tool calls.
   */
  private parseOutput(stdout: string): string {
    if (!stdout.trim()) return '';

    const textParts: string[] = [];
    const lines = stdout.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const part = event.part as Record<string, unknown> | undefined;

        if (event.type === 'text' && part) {
          const text = part.text as string | undefined;
          if (text) textParts.push(text);
        } else if (event.type === 'tool_call' && part && this.onExecutionLog) {
          const toolName = (part.name as string) ?? 'unknown';
          this.onExecutionLog('tool.call', toolName);
        } else if (event.type === 'tool_result' && part && this.onExecutionLog) {
          this.onExecutionLog('tool.result', 'completed');
        }
      } catch {
        // Not valid JSON — accumulate as raw text
        textParts.push(line);
      }
    }

    return textParts.join('') || stdout.trim();
  }
}
