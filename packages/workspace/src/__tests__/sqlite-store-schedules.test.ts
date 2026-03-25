import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ScheduleInfo } from '@skynet-ai/protocol';
import { SqliteStore } from '../sqlite-store.js';

describe('SqliteStore — Schedules', () => {
  let store: SqliteStore;

  const makeSchedule = (overrides?: Partial<ScheduleInfo>): ScheduleInfo => ({
    id: 'sched-1',
    name: 'test-schedule',
    cronExpr: '0 9 * * *',
    agentId: 'agent-1',
    taskTemplate: { title: 'Test', description: 'Test task' },
    enabled: true,
    createdBy: 'human-1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  });

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('saves and retrieves a schedule', () => {
    const sched = makeSchedule();
    store.saveSchedule(sched);

    const retrieved = store.getSchedule('sched-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('test-schedule');
    expect(retrieved!.cronExpr).toBe('0 9 * * *');
    expect(retrieved!.agentId).toBe('agent-1');
    expect(retrieved!.enabled).toBe(true);
    expect(retrieved!.createdBy).toBe('human-1');
    expect(retrieved!.taskTemplate.title).toBe('Test');
  });

  it('lists all schedules', () => {
    store.saveSchedule(makeSchedule({ id: 'a', name: 'first', createdAt: 1 }));
    store.saveSchedule(makeSchedule({ id: 'b', name: 'second', createdAt: 2 }));

    const all = store.listSchedules();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('first');
    expect(all[1].name).toBe('second');
  });

  it('lists schedules filtered by agent ID', () => {
    store.saveSchedule(makeSchedule({ id: 'a', agentId: 'agent-1' }));
    store.saveSchedule(makeSchedule({ id: 'b', agentId: 'agent-2' }));

    expect(store.listSchedules('agent-1')).toHaveLength(1);
    expect(store.listSchedules('agent-2')).toHaveLength(1);
    expect(store.listSchedules('agent-3')).toHaveLength(0);
  });

  it('updates schedule fields', () => {
    store.saveSchedule(makeSchedule());

    const updated = store.updateSchedule('sched-1', { name: 'renamed', enabled: false });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('renamed');
    expect(updated!.enabled).toBe(false);
    expect(updated!.cronExpr).toBe('0 9 * * *'); // unchanged
  });

  it('updateSchedule returns undefined for nonexistent ID', () => {
    expect(store.updateSchedule('nope', { name: 'x' })).toBeUndefined();
  });

  it('updates schedule last run', () => {
    store.saveSchedule(makeSchedule());

    store.updateScheduleLastRun('sched-1', 5000, 10000);
    const sched = store.getSchedule('sched-1');
    expect(sched!.lastRunAt).toBe(5000);
    expect(sched!.nextRunAt).toBe(10000);
  });

  it('deletes a schedule', () => {
    store.saveSchedule(makeSchedule());

    expect(store.deleteSchedule('sched-1')).toBe(true);
    expect(store.getSchedule('sched-1')).toBeUndefined();
    expect(store.deleteSchedule('sched-1')).toBe(false);
  });

  it('handles taskTemplate with optional fields', () => {
    store.saveSchedule(makeSchedule({
      taskTemplate: {
        title: 'Complex',
        description: 'Complex task',
        files: ['src/', 'tests/'],
        metadata: { priority: 'high' },
      },
    }));

    const sched = store.getSchedule('sched-1');
    expect(sched!.taskTemplate.files).toEqual(['src/', 'tests/']);
    expect(sched!.taskTemplate.metadata).toEqual({ priority: 'high' });
  });

  it('stores disabled schedule correctly', () => {
    store.saveSchedule(makeSchedule({ enabled: false }));
    const sched = store.getSchedule('sched-1');
    expect(sched!.enabled).toBe(false);
  });
});
