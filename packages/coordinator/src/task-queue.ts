import { randomUUID } from 'node:crypto';
import type { AgentCard, TaskPayload, TaskStatus } from '@skynet-ai/protocol';

export interface QueuedTask extends TaskPayload {
  createdAt: number;
  updatedAt: number;
  timeoutMs?: number;
}

/**
 * In-memory task queue with transactional semantics.
 *
 * All read-then-write operations are wrapped in a `transaction()` helper that
 * executes the callback synchronously, ensuring atomicity in Node's
 * single-threaded event loop. This pattern mirrors better-sqlite3's
 * `db.transaction()` API so a future migration to SQLite is straightforward.
 */
export class TaskQueue {
  private tasks = new Map<string, QueuedTask>();

  /**
   * Execute `fn` as an atomic unit. In the current in-memory implementation
   * this simply invokes `fn` synchronously (Node is single-threaded so no
   * interleaving is possible). When backed by SQLite, replace this with
   * `db.transaction(fn)`.
   */
  private transaction<T>(fn: () => T): T {
    return fn();
  }

  create(
    title: string,
    description: string,
    files?: string[],
    timeoutMs?: number,
  ): QueuedTask {
    return this.transaction(() => {
      const now = Date.now();
      const task: QueuedTask = {
        taskId: randomUUID(),
        title,
        description,
        status: 'pending',
        files,
        timeoutMs,
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.set(task.taskId, task);
      return task;
    });
  }

  /**
   * Assign a task to an agent. Only tasks in `pending` status can be assigned.
   * Returns `undefined` if the task does not exist or is not pending.
   */
  assign(taskId: string, agentId: string): QueuedTask | undefined {
    return this.transaction(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'pending') return undefined;
      task.assignee = agentId;
      task.status = 'assigned';
      task.updatedAt = Date.now();
      return task;
    });
  }

  updateStatus(taskId: string, status: TaskStatus): QueuedTask | undefined {
    return this.transaction(() => {
      const task = this.tasks.get(taskId);
      if (!task) return undefined;
      task.status = status;
      task.updatedAt = Date.now();
      return task;
    });
  }

  get(taskId: string): QueuedTask | undefined {
    return this.tasks.get(taskId);
  }

  getPending(): QueuedTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'pending');
  }

  getByAgent(agentId: string): QueuedTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.assignee === agentId);
  }

  getAll(): QueuedTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Find tasks that have been assigned or in-progress longer than their
   * `timeoutMs` and reset them to `pending` (unassign). Returns the list
   * of tasks that were timed out.
   */
  checkTimeouts(): QueuedTask[] {
    return this.transaction(() => {
      const now = Date.now();
      const timedOut: QueuedTask[] = [];

      for (const task of this.tasks.values()) {
        if (
          task.timeoutMs !== undefined &&
          (task.status === 'assigned' || task.status === 'in-progress') &&
          now - task.updatedAt >= task.timeoutMs
        ) {
          task.status = 'pending';
          task.assignee = undefined;
          task.updatedAt = now;
          timedOut.push(task);
        }
      }

      return timedOut;
    });
  }

  /** Pick the best idle agent for a pending task based on capabilities */
  pickAgent(task: QueuedTask, agents: AgentCard[]): AgentCard | undefined {
    const idle = agents.filter((a) => a.status === 'idle');
    if (idle.length === 0) return undefined;

    // Simple: pick first idle agent. Future: match capabilities + persona.
    return idle[0];
  }
}
