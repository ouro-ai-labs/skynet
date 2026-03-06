import { execaCommand } from 'execa';
import { AgentType, type SkynetMessage, type TaskPayload, MessageType } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface GeminiCliOptions {
  projectRoot: string;
}

export class GeminiCliAdapter extends AgentAdapter {
  readonly type = AgentType.GEMINI_CLI;
  readonly name = 'gemini-cli';
  private projectRoot: string;

  constructor(options: GeminiCliOptions) {
    super();
    this.projectRoot = options.projectRoot;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execaCommand('gemini --version');
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(msg: SkynetMessage, senderName?: string): Promise<string> {
    const prompt = this.messageToPrompt(msg, senderName);
    return this.runGemini(prompt);
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    const prompt = `Task: ${task.title}\n\nDescription: ${task.description}${
      task.files?.length ? `\n\nRelevant files: ${task.files.join(', ')}` : ''
    }`;

    try {
      const output = await this.runGemini(prompt);
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

  private async runGemini(prompt: string): Promise<string> {
    const fullPrompt = this.persona ? `${this.persona}\n\n${prompt}` : prompt;
    const result = await execaCommand(`echo ${JSON.stringify(fullPrompt)} | gemini`, {
      cwd: this.projectRoot,
      shell: true,
      timeout: 300_000,
    });
    return result.stdout;
  }
}
