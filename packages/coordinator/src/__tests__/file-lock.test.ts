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

  describe('TTL and expiry', () => {
    it('acquires a lock with ttlMs', () => {
      const mgr = new FileLockManager();
      expect(mgr.acquire('src/index.ts', 'agent-1', 5000)).toBe(true);
      const lock = mgr.isLocked('src/index.ts');
      expect(lock).not.toBeNull();
      expect(lock!.ttlMs).toBe(5000);
    });

    it('cleanExpiredLocks removes expired locks', () => {
      const mgr = new FileLockManager();
      mgr.acquire('file-a.ts', 'agent-1', 100);
      mgr.acquire('file-b.ts', 'agent-2', 100);

      // Backdate acquiredAt to simulate expiry
      const lockA = mgr.isLocked('file-a.ts')!;
      const lockB = mgr.isLocked('file-b.ts')!;
      lockA.acquiredAt = Date.now() - 200;
      lockB.acquiredAt = Date.now() - 200;

      const expired = mgr.cleanExpiredLocks();
      expect(expired).toHaveLength(2);
      expect(mgr.isLocked('file-a.ts')).toBeNull();
      expect(mgr.isLocked('file-b.ts')).toBeNull();
    });

    it('cleanExpiredLocks does not remove non-expired locks', () => {
      const mgr = new FileLockManager();
      mgr.acquire('file-a.ts', 'agent-1', 60_000);

      const expired = mgr.cleanExpiredLocks();
      expect(expired).toHaveLength(0);
      expect(mgr.isLocked('file-a.ts')).not.toBeNull();
    });

    it('cleanExpiredLocks does not remove locks without ttlMs', () => {
      const mgr = new FileLockManager();
      mgr.acquire('file-a.ts', 'agent-1');

      // Backdate acquiredAt
      mgr.isLocked('file-a.ts')!.acquiredAt = Date.now() - 999_999;

      const expired = mgr.cleanExpiredLocks();
      expect(expired).toHaveLength(0);
      expect(mgr.isLocked('file-a.ts')).not.toBeNull();
    });

    it('allows reclaiming expired lock from disconnected agent', () => {
      const mgr = new FileLockManager();
      mgr.acquire('file-a.ts', 'agent-1', 100);

      // Lock held by agent-1, agent-2 cannot acquire
      expect(mgr.acquire('file-a.ts', 'agent-2')).toBe(false);

      // Expire the lock
      mgr.isLocked('file-a.ts')!.acquiredAt = Date.now() - 200;
      mgr.cleanExpiredLocks();

      // Now agent-2 can acquire
      expect(mgr.acquire('file-a.ts', 'agent-2')).toBe(true);
      expect(mgr.isLocked('file-a.ts')!.agentId).toBe('agent-2');
    });

    it('mixes expired and non-expired locks correctly', () => {
      const mgr = new FileLockManager();
      mgr.acquire('expired.ts', 'agent-1', 100);
      mgr.acquire('fresh.ts', 'agent-2', 60_000);
      mgr.acquire('no-ttl.ts', 'agent-3');

      // Expire only the first one
      mgr.isLocked('expired.ts')!.acquiredAt = Date.now() - 200;

      const expired = mgr.cleanExpiredLocks();
      expect(expired).toHaveLength(1);
      expect(expired[0].path).toBe('expired.ts');
      expect(mgr.isLocked('fresh.ts')).not.toBeNull();
      expect(mgr.isLocked('no-ttl.ts')).not.toBeNull();
    });
  });
});
