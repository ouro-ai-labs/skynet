import { execaCommand } from 'execa';
import { AgentType, type SkynetMessage, type TaskPayload, MessageType } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface CodexCliOptions {
  projectRoot: string;
  fullAuto?: boolean;
}

export class CodexCliAdapter extends AgentAdapter {
  readonly type = AgentType.CODEX_CLI;
  readonly name = 'codex-cli';
  private projectRoot: string;
  private fullAuto: boolean;

  constructor(options: CodexCliOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.fullAuto = options.fullAuto ?? false;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execaCommand('codex --version');
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(msg: SkynetMessage): Promise<string> {
    const prompt = this.messageToPrompt(msg);
    return this.runCodex(prompt);
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    const prompt = `Task: ${task.title}\n\nDescription: ${task.description}${
      task.files?.length ? `\n\nRelevant files: ${task.files.join(', ')}` : ''
    }`;

    try {
      const output = await this.runCodex(prompt);
      return { success: true, summary: output };
    } catch (err) {
      return {
        success: false,
        summary: 'Task execution failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async dispose(): Promise<void> {}

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

  private async runCodex(prompt: string): Promise<string> {
    const args = ['-q', JSON.stringify(prompt)];
    if (this.fullAuto) {
      args.push('--full-auto');
    }

    const result = await execaCommand(`codex ${args.join(' ')}`, {
      cwd: this.projectRoot,
      shell: true,
      timeout: 300_000,
    });
    return result.stdout;
  }
}
