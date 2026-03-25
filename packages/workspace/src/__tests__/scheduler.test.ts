import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SkynetMessage } from '@skynet-ai/protocol';
import { SqliteStore } from '../sqlite-store.js';
import { Scheduler } from '../scheduler.js';

describe('Scheduler', () => {
  let store: SqliteStore;
  let scheduler: Scheduler;
  let routedMessages: Array<{ agentId: string; msg: SkynetMessage }>;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
    routedMessages = [];
    // Register a fake agent so schedule creation can validate it
    store.saveAgent({
      id: 'agent-1',
      name: 'backend',
      type: 'claude-code' as import('@skynet-ai/protocol').AgentType,
      status: 'idle',
      createdAt: Date.now(),
    });

    scheduler = new Scheduler(
      store,
      (agentId, msg) => { routedMessages.push({ agentId, msg }); },
    );
  });

  afterEach(() => {
    scheduler.stop();
    store.close();
  });

  it('creates a schedule and persists to store', () => {
    const sched = scheduler.create({
      name: 'test-schedule',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'Test', description: 'Test task' },
    });

    expect(sched.name).toBe('test-schedule');
    expect(sched.cronExpr).toBe('0 9 * * *');
    expect(sched.agentId).toBe('agent-1');
    expect(sched.enabled).toBe(true);
    expect(sched.id).toBeTruthy();

    // Verify persisted
    const fromDb = store.getSchedule(sched.id);
    expect(fromDb).toBeDefined();
    expect(fromDb!.name).toBe('test-schedule');
  });

  it('lists schedules', () => {
    scheduler.create({
      name: 'sched-1',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'T1', description: 'D1' },
    });
    scheduler.create({
      name: 'sched-2',
      cronExpr: '0 17 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'T2', description: 'D2' },
    });

    expect(scheduler.list()).toHaveLength(2);
  });

  it('lists schedules filtered by agent', () => {
    store.saveAgent({
      id: 'agent-2',
      name: 'frontend',
      type: 'claude-code' as import('@skynet-ai/protocol').AgentType,
      status: 'idle',
      createdAt: Date.now(),
    });

    scheduler.create({
      name: 'for-1',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'T', description: 'D' },
    });
    scheduler.create({
      name: 'for-2',
      cronExpr: '0 9 * * *',
      agentId: 'agent-2',
      taskTemplate: { title: 'T', description: 'D' },
    });

    expect(scheduler.list('agent-1')).toHaveLength(1);
    expect(scheduler.list('agent-2')).toHaveLength(1);
  });

  it('updates a schedule', () => {
    const sched = scheduler.create({
      name: 'original',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'T', description: 'D' },
    });

    const updated = scheduler.update(sched.id, { name: 'renamed', enabled: false });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('renamed');
    expect(updated!.enabled).toBe(false);
  });

  it('deletes a schedule', () => {
    const sched = scheduler.create({
      name: 'to-delete',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'T', description: 'D' },
    });

    expect(scheduler.delete(sched.id)).toBe(true);
    expect(scheduler.get(sched.id)).toBeUndefined();
    expect(scheduler.delete(sched.id)).toBe(false);
  });

  it('returns undefined when updating nonexistent schedule', () => {
    expect(scheduler.update('nonexistent', { name: 'x' })).toBeUndefined();
  });

  it('throws on invalid cron expression', () => {
    expect(() => scheduler.create({
      name: 'bad-cron',
      cronExpr: 'not-a-cron',
      agentId: 'agent-1',
      taskTemplate: { title: 'T', description: 'D' },
    })).toThrow();
  });

  it('start loads enabled schedules from DB', () => {
    // Create a schedule before starting
    scheduler.create({
      name: 'pre-existing',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: { title: 'T', description: 'D' },
    });

    // Stop and create a new scheduler to simulate restart
    scheduler.stop();
    const newScheduler = new Scheduler(
      store,
      (agentId, msg) => { routedMessages.push({ agentId, msg }); },
    );
    newScheduler.start();
    expect(newScheduler.list()).toHaveLength(1);
    newScheduler.stop();
  });
});
