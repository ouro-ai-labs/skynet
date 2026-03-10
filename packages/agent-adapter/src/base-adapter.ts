import type { AgentType, SkynetMessage, TaskPayload, TaskResultPayload } from '@skynet-ai/protocol';

export interface TaskResult {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  error?: string;
}

/** Serializable session state for persistence across restarts. */
export interface SessionState {
  sessionId: string;
  sessionStarted: boolean;
}

export abstract class AgentAdapter {
  abstract readonly type: AgentType;
  abstract readonly name: string;
  persona?: string;

  /** Check if the underlying CLI tool is installed and available */
  abstract isAvailable(): Promise<boolean>;

  /** Convert a network message into a CLI agent call and return the response */
  abstract handleMessage(msg: SkynetMessage, senderName?: string): Promise<string>;

  /** Execute a standalone task */
  abstract executeTask(task: TaskPayload): Promise<TaskResult>;

  /** Whether this adapter supports forked quick replies while busy. */
  supportsQuickReply(): boolean {
    return false;
  }

  /** Quick reply using a forked context. Only called when supportsQuickReply() is true. */
  async quickReply(_prompt: string): Promise<string> {
    throw new Error('quickReply not implemented');
  }

  /**
   * Interrupt the currently running process (e.g. kill child process).
   * Returns true if something was interrupted, false if nothing was running.
   */
  async interrupt(): Promise<boolean> {
    return false;
  }

  /**
   * Reset the session/conversation context so the agent starts fresh.
   * The adapter remains usable after this call.
   */
  async resetSession(): Promise<void> {
    // Default: no-op — subclasses override if they maintain session state.
  }

  /**
   * Return serializable session state for persistence across restarts.
   * Returns undefined if the adapter does not maintain session state.
   */
  getSessionState(): SessionState | undefined {
    return undefined;
  }

  /**
   * Restore session state from a previous run.
   * Called before the first handleMessage() to resume an existing session.
   */
  restoreSessionState(_state: SessionState): void {
    // Default: no-op — subclasses override if they maintain session state.
  }

  /** Clean up resources (kill child processes, etc.) */
  abstract dispose(): Promise<void>;
}
