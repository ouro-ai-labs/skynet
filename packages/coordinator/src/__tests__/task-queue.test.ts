import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../task-queue.js';
import { AgentType, type AgentCard } from '@skynet/protocol';

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
});
