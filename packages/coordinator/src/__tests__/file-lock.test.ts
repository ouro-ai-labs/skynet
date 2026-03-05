import { describe, it, expect } from 'vitest';
import { FileLockManager } from '../file-lock.js';

describe('FileLockManager', () => {
  it('acquires a lock on an unlocked file', () => {
    const mgr = new FileLockManager();
    expect(mgr.acquire('src/index.ts', 'agent-1')).toBe(true);
  });

  it('allows same agent to re-acquire their own lock', () => {
    const mgr = new FileLockManager();
    mgr.acquire('src/index.ts', 'agent-1');
    expect(mgr.acquire('src/index.ts', 'agent-1')).toBe(true);
  });

  it('prevents another agent from acquiring a locked file', () => {
    const mgr = new FileLockManager();
    mgr.acquire('src/index.ts', 'agent-1');
    expect(mgr.acquire('src/index.ts', 'agent-2')).toBe(false);
  });

  it('releases a lock', () => {
    const mgr = new FileLockManager();
    mgr.acquire('src/index.ts', 'agent-1');
    expect(mgr.release('src/index.ts', 'agent-1')).toBe(true);
    expect(mgr.acquire('src/index.ts', 'agent-2')).toBe(true);
  });

  it('does not release another agents lock', () => {
    const mgr = new FileLockManager();
    mgr.acquire('src/index.ts', 'agent-1');
    expect(mgr.release('src/index.ts', 'agent-2')).toBe(false);
  });

  it('checks if a file is locked', () => {
    const mgr = new FileLockManager();
    expect(mgr.isLocked('src/index.ts')).toBeNull();

    mgr.acquire('src/index.ts', 'agent-1');
    const lock = mgr.isLocked('src/index.ts');
    expect(lock).not.toBeNull();
    expect(lock!.agentId).toBe('agent-1');
  });

  it('releases all locks for an agent', () => {
    const mgr = new FileLockManager();
    mgr.acquire('file-a.ts', 'agent-1');
    mgr.acquire('file-b.ts', 'agent-1');
    mgr.acquire('file-c.ts', 'agent-2');

    mgr.releaseAll('agent-1');

    expect(mgr.isLocked('file-a.ts')).toBeNull();
    expect(mgr.isLocked('file-b.ts')).toBeNull();
    expect(mgr.isLocked('file-c.ts')).not.toBeNull();
  });

  it('lists locks for a specific agent', () => {
    const mgr = new FileLockManager();
    mgr.acquire('file-a.ts', 'agent-1');
    mgr.acquire('file-b.ts', 'agent-1');
    mgr.acquire('file-c.ts', 'agent-2');

    const locks = mgr.getLocksForAgent('agent-1');
    expect(locks).toHaveLength(2);
    expect(locks.map((l) => l.path).sort()).toEqual(['file-a.ts', 'file-b.ts']);
  });

  it('lists all locks', () => {
    const mgr = new FileLockManager();
    mgr.acquire('file-a.ts', 'agent-1');
    mgr.acquire('file-b.ts', 'agent-2');

    expect(mgr.listLocks()).toHaveLength(2);
  });
});
