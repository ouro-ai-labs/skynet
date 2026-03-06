import type { AgentType, SkynetMessage, TaskPayload, TaskResultPayload } from '@skynet/protocol';

export interface TaskResult {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}

export abstract class AgentAdapter {
  abstract readonly type: AgentType;
  abstract readonly name: string;

  /** Check if the underlying CLI tool is installed and available */
  abstract isAvailable(): Promise<boolean>;

  /** Convert a network message into a CLI agent call and return the response */
  abstract handleMessage(msg: SkynetMessage, senderName?: string): Promise<string>;

  /** Execute a standalone task */
  abstract executeTask(task: TaskPayload): Promise<TaskResult>;

  /** Associate adapter with a room for session persistence. No-op by default. */
  setRoomId(_roomId: string): void {}

  /** Whether this adapter supports forked quick replies while busy. */
  supportsQuickReply(): boolean {
    return false;
  }

  /** Quick reply using a forked context. Only called when supportsQuickReply() is true. */
  async quickReply(_prompt: string): Promise<string> {
    throw new Error('quickReply not implemented');
  }

  /** Clean up resources (kill child processes, etc.) */
  abstract dispose(): Promise<void>;
}
