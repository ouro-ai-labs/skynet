import { describe, it, expect, vi } from 'vitest';
import { TaskQueue } from '../task-queue.js';
import { AgentType, type AgentCard } from '@skynet-ai/protocol';

function makeAgent(id: string, status: 'idle' | 'busy' = 'idle'): AgentCard {
  return {
    id,
    name: id,
    type: AgentType.CLAUDE_CODE,
    capabilities: ['code-edit'],
    status,
  };
}

describe('TaskQueue', () => {
  it('creates a task with pending status', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix the login bug');

    expect(task.taskId).toBeDefined();
    expect(task.title).toBe('Fix bug');
    expect(task.description).toBe('Fix the login bug');
    expect(task.status).toBe('pending');
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it('creates a task with files', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix it', ['src/auth.ts']);

    expect(task.files).toEqual(['src/auth.ts']);
  });

  it('creates a task with timeoutMs', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix it', undefined, 60_000);

    expect(task.timeoutMs).toBe(60_000);
  });

  it('assigns a task to an agent', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix it');
    const assigned = queue.assign(task.taskId, 'agent-1');

    expect(assigned).toBeDefined();
    expect(assigned!.assignee).toBe('agent-1');
    expect(assigned!.status).toBe('assigned');
  });

  it('returns undefined when assigning non-existent task', () => {
    const queue = new TaskQueue();
    expect(queue.assign('non-existent', 'agent-1')).toBeUndefined();
  });

  it('prevents assigning an already-assigned task', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix it');
    queue.assign(task.taskId, 'agent-1');

    // Second assignment should fail because task is no longer pending
    expect(queue.assign(task.taskId, 'agent-2')).toBeUndefined();
    // Original assignment should remain
    expect(queue.get(task.taskId)!.assignee).toBe('agent-1');
  });

  it('prevents assigning a completed task', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix it');
    queue.assign(task.taskId, 'agent-1');
    queue.updateStatus(task.taskId, 'completed');

    expect(queue.assign(task.taskId, 'agent-2')).toBeUndefined();
  });

  it('updates task status', () => {
    const queue = new TaskQueue();
    const task = queue.create('Fix bug', 'Fix it');
    queue.assign(task.taskId, 'agent-1');
    queue.updateStatus(task.taskId, 'in-progress');

    expect(queue.get(task.taskId)!.status).toBe('in-progress');
  });

  it('returns pending tasks', () => {
    const queue = new TaskQueue();
    queue.create('Task 1', 'desc');
    queue.create('Task 2', 'desc');
    const t3 = queue.create('Task 3', 'desc');
    queue.assign(t3.taskId, 'agent-1');

    expect(queue.getPending()).toHaveLength(2);
  });

  it('returns tasks by agent', () => {
    const queue = new TaskQueue();
    const t1 = queue.create('Task 1', 'desc');
    const t2 = queue.create('Task 2', 'desc');
    queue.create('Task 3', 'desc');
    queue.assign(t1.taskId, 'agent-1');
    queue.assign(t2.taskId, 'agent-1');

    expect(queue.getByAgent('agent-1')).toHaveLength(2);
    expect(queue.getByAgent('agent-2')).toHaveLength(0);
  });

  it('picks an idle agent', () => {
    const queue = new TaskQueue();
    const task = queue.create('Task', 'desc');
    const agents = [makeAgent('busy-1', 'busy'), makeAgent('idle-1', 'idle')];

    const picked = queue.pickAgent(task, agents);
    expect(picked).toBeDefined();
    expect(picked!.id).toBe('idle-1');
  });

  it('returns undefined when no idle agents', () => {
    const queue = new TaskQueue();
    const task = queue.create('Task', 'desc');
    const agents = [makeAgent('busy-1', 'busy')];

    expect(queue.pickAgent(task, agents)).toBeUndefined();
  });

  describe('checkTimeouts', () => {
    it('returns empty array when no tasks have timed out', () => {
      const queue = new TaskQueue();
      const task = queue.create('Task', 'desc', undefined, 60_000);
      queue.assign(task.taskId, 'agent-1');

      expect(queue.checkTimeouts()).toHaveLength(0);
    });

    it('resets expired assigned tasks to pending', () => {
      const queue = new TaskQueue();
      const task = queue.create('Task', 'desc', undefined, 100);
      queue.assign(task.taskId, 'agent-1');

      // Simulate time passing by backdating updatedAt
      const stored = queue.get(task.taskId)!;
      stored.updatedAt = Date.now() - 200;

      const timedOut = queue.checkTimeouts();
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].taskId).toBe(task.taskId);
      expect(timedOut[0].status).toBe('pending');
      expect(timedOut[0].assignee).toBeUndefined();
    });

    it('resets expired in-progress tasks to pending', () => {
      const queue = new TaskQueue();
      const task = queue.create('Task', 'desc', undefined, 100);
      queue.assign(task.taskId, 'agent-1');
      queue.updateStatus(task.taskId, 'in-progress');

      const stored = queue.get(task.taskId)!;
      stored.updatedAt = Date.now() - 200;

      const timedOut = queue.checkTimeouts();
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].status).toBe('pending');
    });

    it('does not affect tasks without timeoutMs', () => {
      const queue = new TaskQueue();
      const task = queue.create('Task', 'desc');
      queue.assign(task.taskId, 'agent-1');

      // Backdate updatedAt
      const stored = queue.get(task.taskId)!;
      stored.updatedAt = Date.now() - 999_999;

      expect(queue.checkTimeouts()).toHaveLength(0);
      expect(queue.get(task.taskId)!.status).toBe('assigned');
    });

    it('does not affect completed or failed tasks', () => {
      const queue = new TaskQueue();
      const t1 = queue.create('T1', 'desc', undefined, 100);
      const t2 = queue.create('T2', 'desc', undefined, 100);
      queue.assign(t1.taskId, 'agent-1');
      queue.assign(t2.taskId, 'agent-1');
      queue.updateStatus(t1.taskId, 'completed');
      queue.updateStatus(t2.taskId, 'failed');

      // Backdate
      queue.get(t1.taskId)!.updatedAt = Date.now() - 200;
      queue.get(t2.taskId)!.updatedAt = Date.now() - 200;

      expect(queue.checkTimeouts()).toHaveLength(0);
    });

    it('allows re-assignment after timeout reset', () => {
      const queue = new TaskQueue();
      const task = queue.create('Task', 'desc', undefined, 100);
      queue.assign(task.taskId, 'agent-1');

      // Expire it
      queue.get(task.taskId)!.updatedAt = Date.now() - 200;
      queue.checkTimeouts();

      // Should be re-assignable
      const reassigned = queue.assign(task.taskId, 'agent-2');
      expect(reassigned).toBeDefined();
      expect(reassigned!.assignee).toBe('agent-2');
      expect(reassigned!.status).toBe('assigned');
    });
  });
});
