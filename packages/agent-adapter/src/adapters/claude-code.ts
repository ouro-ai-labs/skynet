import { execaCommand } from 'execa';
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
  private lastSessionId: string | null = null;
  private projectRoot: string;
  private allowedTools?: string[];
  private model?: string;

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

  async handleMessage(msg: SkynetMessage): Promise<string> {
    const prompt = this.messageToPrompt(msg);
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

  private messageToPrompt(msg: SkynetMessage): string {
    switch (msg.type) {
      case MessageType.CHAT: {
        const payload = msg.payload as { text: string };
        return `Message from ${msg.from}: ${payload.text}`;
      }
      case MessageType.TASK_ASSIGN: {
        const payload = msg.payload as TaskPayload;
        return `Task assigned: ${payload.title}\n\n${payload.description}`;
      }
      default:
        return `Received ${msg.type} from ${msg.from}: ${JSON.stringify(msg.payload)}`;
    }
  }

  private async runClaude(prompt: string): Promise<string> {
    const args = ['-p', prompt, '--output-format', 'text'];

    if (this.allowedTools?.length) {
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this.lastSessionId) {
      args.push('--resume', this.lastSessionId);
    }

    const result = await execaCommand(`claude ${args.map((a) => `"${a}"`).join(' ')}`, {
      cwd: this.projectRoot,
      timeout: 300_000, // 5 min timeout
    });

    // Try to capture session ID from output for context continuity
    const sessionMatch = result.stderr?.match(/session[:\s]+([a-f0-9-]+)/i);
    if (sessionMatch) {
      this.lastSessionId = sessionMatch[1];
    }

    return result.stdout;
  }
}
