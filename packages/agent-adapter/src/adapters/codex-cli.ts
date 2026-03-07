import { AgentType, type SkynetMessage, type TaskPayload } from '@skynet/protocol';
import { AgentAdapter, type TaskResult } from '../base-adapter.js';

export interface CodexCliOptions {
  projectRoot: string;
  fullAuto?: boolean;
}

/**
 * Stub adapter for Codex CLI.
 * Session management and multi-turn support are not yet implemented.
 * Will be completed once the Claude Code adapter is stable.
 */
export class CodexCliAdapter extends AgentAdapter {
  readonly type = AgentType.CODEX_CLI;
  readonly name = 'codex-cli';

  constructor(_options: CodexCliOptions) {
    super();
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async handleMessage(_msg: SkynetMessage, _senderName?: string): Promise<string> {
    throw new Error('CodexCliAdapter is not yet implemented');
  }

  async executeTask(_task: TaskPayload): Promise<TaskResult> {
    throw new Error('CodexCliAdapter is not yet implemented');
  }

  async dispose(): Promise<void> {}
}
