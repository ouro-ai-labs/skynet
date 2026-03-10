import { randomUUID } from 'node:crypto';
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

/** Build a copy of process.env without the nested-session guard var */
function spawnEnv(): Record<string, string | undefined> {
  return { ...process.env, CLAUDECODE: undefined };
}

/**
 * Sanitize execa errors to avoid leaking the full command line (which includes
 * --append-system-prompt with the entire persona) when errors are broadcast.
 * Execa errors have a `shortMessage` that omits the command; we prefer that.
 */
function sanitizeExecaError(err: unknown): Error {
  if (err instanceof Error) {
    // execa errors expose `shortMessage` without the full command string
    const short = (err as { shortMessage?: string }).shortMessage;
    if (short && short !== err.message) {
      const sanitized = new Error(short);
      sanitized.name = err.name;
      return sanitized;
    }
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

  async handleMessage(msg: SkynetMessage, senderName?: string): Promise<string> {
    const prompt = this.messageToPrompt(msg, senderName);
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
        timeout: 60_000, // 1 min timeout for quick replies
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
    const args = ['-p', prompt, '--output-format', 'text', '--dangerously-skip-permissions'];

    for (const imgPath of images) {
      args.push('--image', imgPath);
    }

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
    const proc = execa('claude', args, {
      cwd: this.projectRoot,
      stdin: 'ignore',
      env: spawnEnv(),
      timeout: 1_200_000, // 20 min timeout
    });
    this.runningProcess = proc;
    try {
      const result = await proc;

      this.sessionStarted = true;
      this.runningProcess = null;

      return result.stdout;
    } catch (err) {
      this.runningProcess = null;
      // If this was the first call (--session-id), the session was created on disk
      // even though it timed out. Mark it as started so subsequent calls use --resume
      // instead of --session-id, avoiding "Session ID already in use" errors.
      if (isFirstCall) {
        this.sessionStarted = true;
      }
      throw sanitizeExecaError(err);
    }
  }
}
