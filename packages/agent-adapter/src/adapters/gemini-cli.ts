import { AgentType, type SkynetMessage, type TaskPayload } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface GeminiCliOptions {
  projectRoot: string;
}

/**
 * Stub adapter for Gemini CLI.
 * Session management and multi-turn support are not yet implemented.
 * Will be completed once the Claude Code adapter is stable.
 */
export class GeminiCliAdapter extends AgentAdapter {
  readonly type = AgentType.GEMINI_CLI;
  readonly name = 'gemini-cli';

  constructor(_options: GeminiCliOptions) {
    super();
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async handleMessage(_msg: SkynetMessage, _senderName?: string): Promise<string> {
    throw new Error('GeminiCliAdapter is not yet implemented');
  }

  async executeTask(_task: TaskPayload): Promise<TaskResult> {
    throw new Error('GeminiCliAdapter is not yet implemented');
  }

  async dispose(): Promise<void> {}
}
