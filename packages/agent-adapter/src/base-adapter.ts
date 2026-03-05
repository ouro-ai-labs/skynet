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

  /** Clean up resources (kill child processes, etc.) */
  abstract dispose(): Promise<void>;
}
