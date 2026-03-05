import { randomUUID } from 'node:crypto';
import type { AgentCard, TaskPayload, TaskStatus } from '@skynet/protocol';

export interface QueuedTask extends TaskPayload {
  createdAt: number;
  updatedAt: number;
}

export class TaskQueue {
  private tasks = new Map<string, QueuedTask>();

  create(title: string, description: string, files?: string[]): QueuedTask {
    const task: QueuedTask = {
      taskId: randomUUID(),
      title,
      description,
      status: 'pending',
      files,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  assign(taskId: string, agentId: string): QueuedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    task.assignee = agentId;
    task.status = 'assigned';
    task.updatedAt = Date.now();
    return task;
  }

  updateStatus(taskId: string, status: TaskStatus): QueuedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    task.status = status;
    task.updatedAt = Date.now();
    return task;
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

  /** Pick the best idle agent for a pending task based on capabilities */
  pickAgent(task: QueuedTask, agents: AgentCard[]): AgentCard | undefined {
    const idle = agents.filter((a) => a.status === 'idle');
    if (idle.length === 0) return undefined;

    // Simple: pick first idle agent. Future: match capabilities + persona.
    return idle[0];
  }
}
