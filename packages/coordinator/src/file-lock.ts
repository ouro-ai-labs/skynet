export interface FileLock {
  path: string;
  agentId: string;
  acquiredAt: number;
  ttlMs?: number;
}

export class FileLockManager {
  private locks = new Map<string, FileLock>();

  acquire(path: string, agentId: string, ttlMs?: number): boolean {
    const existing = this.locks.get(path);
    if (existing && existing.agentId !== agentId) {
      return false;
    }
    this.locks.set(path, { path, agentId, acquiredAt: Date.now(), ttlMs });
    return true;
  }

  release(path: string, agentId: string): boolean {
    const existing = this.locks.get(path);
    if (!existing || existing.agentId !== agentId) {
      return false;
    }
    this.locks.delete(path);
    return true;
  }

  releaseAll(agentId: string): void {
    for (const [, lock] of this.locks) {
      if (lock.agentId === agentId) {
        this.locks.delete(lock.path);
      }
    }
  }

  isLocked(path: string): FileLock | null {
    return this.locks.get(path) ?? null;
  }

  getLocksForAgent(agentId: string): FileLock[] {
    return Array.from(this.locks.values()).filter((l) => l.agentId === agentId);
  }

  listLocks(): FileLock[] {
    return Array.from(this.locks.values());
  }

  /**
   * Remove all locks whose TTL has expired. Returns the list of expired locks.
   * Locks without a `ttlMs` never expire through this mechanism.
   */
  cleanExpiredLocks(): FileLock[] {
    const now = Date.now();
    const expired: FileLock[] = [];

    for (const [, lock] of this.locks) {
      if (lock.ttlMs !== undefined && now - lock.acquiredAt >= lock.ttlMs) {
        expired.push(lock);
        this.locks.delete(lock.path);
      }
    }

    return expired;
  }
}
