import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa, execaCommand, type ResultPromise } from 'execa';
import { AgentType, type SkynetMessage, type ChatPayload, type TaskPayload, MessageType } from '@skynet-ai/protocol';
import { AgentAdapter, type TaskResult, type SessionState } from '../base-adapter.js';

export interface ClaudeCodeOptions {
  projectRoot: string;
  allowedTools?: string[];
  model?: string;
}

/** Build a copy of process.env without the nested-session guard var and agent teams */
function spawnEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    CLAUDECODE: undefined,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined,
  };
}

/**
 * Sanitize execa errors to avoid leaking the full command line (which includes
 * --append-system-prompt with the entire persona) when errors are broadcast.
 * Execa errors have a `shortMessage` that omits the command; we prefer that.
 */
function sanitizeExecaError(err: unknown): Error {
  if (err instanceof Error) {
    const errRecord = err as unknown as Record<string, unknown>;
    // Prefer execa's shortMessage (omits the full command line) over message (which leaks it)
    const shortMessage = errRecord.shortMessage as string | undefined;
    // Collect stderr from execa's native property or our manually-attached stderrOutput
    const stderr = (errRecord.stderrOutput as string | undefined)
      ?? (typeof errRecord.stderr === 'string' && errRecord.stderr ? errRecord.stderr : undefined);
    if (shortMessage) {
      const msg = stderr ? `${shortMessage}: ${stderr}` : shortMessage;
      const sanitized = new Error(msg);
      sanitized.name = err.name;
      return sanitized;
    }
    // Fallback: build a clean message from exit code + stderr when available,
    // otherwise preserve the original message (safe for non-execa errors)
    const exitCode = errRecord.exitCode as number | undefined;
    if (exitCode !== undefined || stderr) {
      const parts: string[] = [];
      parts.push(exitCode !== undefined ? `Command failed with exit code ${exitCode}` : 'Command failed');
      if (stderr) parts.push(stderr);
      const sanitized = new Error(parts.join(': '));
      sanitized.name = err.name;
      return sanitized;
    }
    // No execa metadata — return the original error as-is
    return err;
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class ClaudeCodeAdapter extends AgentAdapter {
  readonly type = AgentType.CLAUDE_CODE;
  readonly name = 'claude-code';
  private projectRoot: string;
  private allowedTools?: string[];
  private model?: string;
  private sessionId: string = randomUUID();
  private sessionStarted = false;
  /** Track the currently running child process for interrupt support. */
  private runningProcess: ResultPromise | null = null;

  constructor(options: ClaudeCodeOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.allowedTools = options.allowedTools;
    this.model = options.model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execaCommand('claude --version');
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(msg: SkynetMessage, senderName?: string, notices?: string): Promise<string> {
    const body = this.messageToPrompt(msg, senderName);
    const prompt = notices ? `${notices}\n\n${body}` : body;
    this.onPrompt?.(prompt, { type: 'message' });
    const images = await this.extractImagePaths(msg);
    try {
      return await this.runClaude(prompt, images);
    } finally {
      // Clean up temp image files
      for (const p of images) {
        await unlink(p).catch(() => {});
      }
    }
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    const prompt = `Task: ${task.title}\n\nDescription: ${task.description}${
      task.files?.length ? `\n\nRelevant files: ${task.files.join(', ')}` : ''
    }`;
    this.onPrompt?.(prompt, { type: 'task' });

    try {
      const output = await this.runClaude(prompt);
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
      '-p', prompt,
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--resume', this.sessionId,
      '--fork-session',
    ];

    if (this.model) {
      args.push('--model', this.model);
    }

    try {
      const result = await execa('claude', args, {
        cwd: this.projectRoot,
        stdin: 'ignore',
        env: spawnEnv(),
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
    // Kill any running process first
    await this.interrupt();
    // Start a fresh session
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

  /** Write base64-encoded image attachments to temp files for CLI consumption. */
  private async extractImagePaths(msg: SkynetMessage): Promise<string[]> {
    if (msg.type !== MessageType.CHAT) return [];
    const payload = msg.payload as ChatPayload;
    if (!payload.attachments?.length) return [];

    const paths: string[] = [];
    for (const att of payload.attachments) {
      if (att.type !== 'image') continue;
      const ext = att.mimeType.split('/')[1] ?? 'png';
      const tmpPath = join(tmpdir(), `skynet-img-${randomUUID()}.${ext}`);
      await writeFile(tmpPath, Buffer.from(att.data, 'base64'));
      paths.push(tmpPath);
    }
    return paths;
  }

  private async runClaude(prompt: string, images: string[] = []): Promise<string> {
    // Append image file paths to the prompt so Claude can read them with its
    // built-in Read tool (which supports images). There is no --image CLI flag.
    let fullPrompt = prompt;
    if (images.length > 0) {
      const imageRefs = images.map((p) => `Image: ${p}`).join('\n');
      fullPrompt = `${prompt}\n\n${imageRefs}\n\nPlease read the image file(s) above to view them.`;
    }

    const args = ['-p', fullPrompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];

    if (this.allowedTools?.length) {
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this.persona) {
      args.push('--append-system-prompt', this.persona);
    }

    if (this.sessionStarted) {
      // Continue existing session
      args.push('--resume', this.sessionId);
    } else {
      // First call: create session with pre-assigned ID
      args.push('--session-id', this.sessionId);
    }

    const isFirstCall = !this.sessionStarted;
    const sessionIdAtStart = this.sessionId;
    const proc = execa('claude', args, {
      cwd: this.projectRoot,
      stdin: 'ignore',
      env: spawnEnv(),
      timeout: 0, // no timeout — let the agent run until done
    });
    this.runningProcess = proc;
    try {
      const resultText = await this.parseStreamJson(proc);

      // Only update state if the session hasn't been reset while we were awaiting.
      // A concurrent resetSession() changes sessionId; if that happened, our result
      // belongs to the old session and must not touch the new session state.
      if (this.sessionId === sessionIdAtStart) {
        this.sessionStarted = true;
      }
      this.runningProcess = null;

      return resultText;
    } catch (err) {
      this.runningProcess = null;
      // If this was the first call (--session-id), the session was created on disk
      // even though it timed out. Mark it as started so subsequent calls use --resume
      // instead of --session-id, avoiding "Session ID already in use" errors.
      // Skip if the session was reset concurrently — the old session is irrelevant.
      if (isFirstCall && this.sessionId === sessionIdAtStart) {
        this.sessionStarted = true;
      }
      throw sanitizeExecaError(err);
    }
  }

  /**
   * Parse stream-json JSONL output from Claude CLI.
   * Emits execution log events for tool calls/results and returns the final result text.
   */
  private async parseStreamJson(proc: ResultPromise): Promise<string> {
    let resultText = '';

    // Collect stderr separately for error diagnostics
    const stderrChunks: string[] = [];
    if (proc.stderr) {
      const stderrRl = createInterface({ input: proc.stderr as unknown as NodeJS.ReadableStream });
      // Don't await — read stderr in background while processing stdout
      (async () => {
        for await (const line of stderrRl) {
          stderrChunks.push(line);
        }
      })().catch(() => {});
    }

    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout as unknown as NodeJS.ReadableStream });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          this.handleStreamEvent(event);

          if (event.type === 'result') {
            resultText = (event.result as string) ?? '';
            // Stop reading immediately — the result is the last meaningful
            // event.  If Claude CLI spawned long-running child processes
            // (e.g. Vite dev server) that inherited stdout, the readline
            // iterator would block forever waiting for EOF.
            break;
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    // Wait for the process to finish, but don't hang forever.
    // Claude CLI may leave child processes running (e.g. dev servers started
    // during a smoke test), which prevents the process from exiting even though
    // the result has already been streamed.
    // If the process already exited (common case), await resolves immediately
    // with no timer overhead. Only start the kill timer when it's still running.
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
      // Attach stderr to the error for diagnostics
      if (stderrChunks.length > 0 && err instanceof Error) {
        (err as unknown as Record<string, unknown>).stderrOutput = stderrChunks.join('\n');
      }
      // If the process was killed due to timeout, don't propagate — we already have the result
      if (resultText) return resultText;
      throw err;
    } finally {
      if (killTimer) clearTimeout(killTimer);
    }

    return resultText;
  }

  /**
   * Build a human-readable one-line summary for a tool call.
   * Shows the tool name plus key parameters so watchers can tell what's happening.
   */
  private formatToolCallSummary(toolName: string, input?: Record<string, unknown>): string {
    if (!input) return toolName;

    switch (toolName) {
      case 'Read':
        return `Read ${input.file_path ?? ''}`;
      case 'Write':
        return `Write ${input.file_path ?? ''}`;
      case 'Edit':
        return `Edit ${input.file_path ?? ''}`;
      case 'Glob':
        return `Glob ${input.pattern ?? ''}`;
      case 'Grep':
        return `Grep ${input.pattern ?? ''}`;
      case 'Bash': {
        const cmd = input.command as string | undefined;
        if (!cmd) return 'Bash';
        const short = cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
        return `Bash: ${short}`;
      }
      case 'Agent':
        return `Agent: ${input.description ?? input.prompt ?? ''}`;
      default: {
        // For unknown tools, show the first string-valued parameter
        const firstVal = Object.values(input).find((v) => typeof v === 'string') as string | undefined;
        if (firstVal) {
          const short = firstVal.length > 60 ? firstVal.slice(0, 60) + '…' : firstVal;
          return `${toolName}: ${short}`;
        }
        return toolName;
      }
    }
  }

  /** Handle a single stream-json event and emit execution logs. */
  private handleStreamEvent(event: Record<string, unknown>): void {
    if (!this.onExecutionLog) return;

    if (event.type === 'assistant') {
      const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
      if (!message?.content) return;

      for (const block of message.content) {
        if (block.type === 'tool_use') {
          const toolName = (block.name as string) ?? 'unknown';
          const input = block.input as Record<string, unknown> | undefined;
          const summary = this.formatToolCallSummary(toolName, input);
          this.onExecutionLog('tool.call', summary, { input });
        }
      }
    } else if (event.type === 'tool_result') {
      const content = event.content as string | undefined;
      const summary = content
        ? content.length > 200 ? content.slice(0, 200) + '...' : content
        : 'completed';
      this.onExecutionLog('tool.result', summary);
    }
  }
}
