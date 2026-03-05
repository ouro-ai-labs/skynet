import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa, execaCommand } from 'execa';
import { AgentType, type SkynetMessage, type TaskPayload, MessageType } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface ClaudeCodeOptions {
  projectRoot: string;
  allowedTools?: string[];
  model?: string;
  sessionStorePath?: string;
}

export class ClaudeCodeAdapter extends AgentAdapter {
  readonly type = AgentType.CLAUDE_CODE;
  readonly name = 'claude-code';
  private roomId: string | null = null;
  private projectRoot: string;
  private allowedTools?: string[];
  private model?: string;
  private sessionStorePath: string;

  constructor(options: ClaudeCodeOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.allowedTools = options.allowedTools;
    this.model = options.model;
    this.sessionStorePath = options.sessionStorePath ?? join(options.projectRoot, '.skynet', 'sessions.json');
  }

  override setRoomId(roomId: string): void {
    this.roomId = roomId;
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

  private loadSessionId(): string | null {
    if (!this.roomId) return null;
    try {
      const data = JSON.parse(readFileSync(this.sessionStorePath, 'utf-8')) as Record<string, string>;
      return data[this.roomId] ?? null;
    } catch {
      return null;
    }
  }

  private saveSessionId(sessionId: string): void {
    if (!this.roomId) return;
    let data: Record<string, string> = {};
    try {
      data = JSON.parse(readFileSync(this.sessionStorePath, 'utf-8')) as Record<string, string>;
    } catch {
      // File doesn't exist yet
    }
    data[this.roomId] = sessionId;
    mkdirSync(join(this.sessionStorePath, '..'), { recursive: true });
    writeFileSync(this.sessionStorePath, JSON.stringify(data, null, 2));
  }

  private async runClaude(prompt: string): Promise<string> {
    const args = ['-p', prompt, '--output-format', 'text'];

    if (this.allowedTools?.length) {
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    const sessionId = this.loadSessionId();
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    const result = await execa('claude', args, {
      cwd: this.projectRoot,
      timeout: 300_000, // 5 min timeout
    });

    // Try to capture session ID from output for context continuity
    const sessionMatch = result.stderr?.match(/session[:\s]+([a-f0-9-]+)/i);
    if (sessionMatch) {
      this.saveSessionId(sessionMatch[1]);
    }

    return result.stdout;
  }
}
