import { randomUUID } from 'node:crypto';
import { execa, execaCommand } from 'execa';
import { AgentType, type SkynetMessage, type TaskPayload, MessageType } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

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
    return this.runClaude(prompt);
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

  async dispose(): Promise<void> {
    // No persistent process to clean up; each call is a new process
  }

  private messageToPrompt(msg: SkynetMessage, senderName?: string): string {
    const sender = senderName ?? msg.from;
    switch (msg.type) {
      case MessageType.CHAT: {
        const payload = msg.payload as { text: string };
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

  private async runClaude(prompt: string): Promise<string> {
    const args = ['-p', prompt, '--output-format', 'text', '--dangerously-skip-permissions'];

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
    try {
      const result = await execa('claude', args, {
        cwd: this.projectRoot,
        stdin: 'ignore',
        env: spawnEnv(),
        timeout: 1_200_000, // 20 min timeout
      });

      this.sessionStarted = true;

      return result.stdout;
    } catch (err) {
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
