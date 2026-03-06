import { randomUUID } from 'node:crypto';
import { execa, execaCommand } from 'execa';
import { AgentType, type SkynetMessage, type TaskPayload, MessageType } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface ClaudeCodeOptions {
  projectRoot: string;
  allowedTools?: string[];
  model?: string;
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

  override setRoomId(_roomId: string): void {
    // Reset session for new room
    this.sessionId = randomUUID();
    this.sessionStarted = false;
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

    const result = await execa('claude', args, {
      cwd: this.projectRoot,
      stdin: 'ignore',
      timeout: 60_000, // 1 min timeout for quick replies
    });

    return result.stdout;
  }

  async dispose(): Promise<void> {
    // No persistent process to clean up; each call is a new process
  }

  private messageToPrompt(msg: SkynetMessage, senderName?: string): string {
    const sender = senderName ?? msg.from;
    const room = this.roomName ? `[${this.roomName}] ` : '';
    switch (msg.type) {
      case MessageType.CHAT: {
        const payload = msg.payload as { text: string };
        return `${room}Message from ${sender}: ${payload.text}`;
      }
      case MessageType.TASK_ASSIGN: {
        const payload = msg.payload as TaskPayload;
        return `${room}Task assigned: ${payload.title}\n\n${payload.description}`;
      }
      default:
        return `${room}Received ${msg.type} from ${sender}: ${JSON.stringify(msg.payload)}`;
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

    const result = await execa('claude', args, {
      cwd: this.projectRoot,
      stdin: 'ignore',
      timeout: 300_000, // 5 min timeout
    });

    this.sessionStarted = true;

    return result.stdout;
  }
}
