import { execaCommand } from 'execa';
import { AgentType, type SkynetMessage, type TaskPayload, MessageType } from '@skynet-ai/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface GenericAdapterConfig {
  name: string;
  command: string;
  args?: string[];
  shell?: boolean;
  promptFlag?: string;
  versionCommand?: string;
  projectRoot: string;
  timeout?: number;
}

/** Sanitize execa errors to avoid leaking the full command line when broadcast. */
function sanitizeExecaError(err: unknown): Error {
  if (err instanceof Error) {
    const short = (err as { shortMessage?: string }).shortMessage;
    if (short && short !== err.message) {
      const sanitized = new Error(short);
      sanitized.name = err.name;
      return sanitized;
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class GenericAdapter extends AgentAdapter {
  readonly type = AgentType.GENERIC;
  readonly name: string;
  private config: GenericAdapterConfig;

  constructor(config: GenericAdapterConfig) {
    super();
    this.name = config.name;
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.versionCommand) return true;
    try {
      await execaCommand(this.config.versionCommand);
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(msg: SkynetMessage, _senderName?: string): Promise<string> {
    const prompt = this.messageToPrompt(msg);
    this.onPrompt?.(prompt, { type: 'message' });
    return this.run(prompt);
  }

  async executeTask(task: TaskPayload): Promise<TaskResult> {
    const prompt = `Task: ${task.title}\n\nDescription: ${task.description}`;
    this.onPrompt?.(prompt, { type: 'task' });
    try {
      const output = await this.run(prompt);
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
        return payload.text;
      }
      case MessageType.TASK_ASSIGN: {
        const payload = msg.payload as TaskPayload;
        return `${payload.title}: ${payload.description}`;
      }
      default:
        return JSON.stringify(msg.payload);
    }
  }

  private async run(prompt: string): Promise<string> {
    if (this.persona) prompt = `${this.persona}\n\n${prompt}`;
    const { command, args = [], promptFlag, shell } = this.config;

    let cmd: string;
    if (promptFlag) {
      cmd = `${command} ${args.join(' ')} ${promptFlag} ${JSON.stringify(prompt)}`.trim();
    } else {
      // Pipe mode
      cmd = `echo ${JSON.stringify(prompt)} | ${command} ${args.join(' ')}`.trim();
    }

    try {
      const result = await execaCommand(cmd, {
        cwd: this.config.projectRoot,
        shell: shell ?? true,
        timeout: this.config.timeout ?? 0,
      });
      return result.stdout;
    } catch (err) {
      throw sanitizeExecaError(err);
    }
  }
}
