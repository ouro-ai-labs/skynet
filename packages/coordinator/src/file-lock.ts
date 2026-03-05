export interface FileLock {
  path: string;
  agentId: string;
  acquiredAt: number;
}

export class FileLockManager {
  private locks = new Map<string, FileLock>();

  acquire(path: string, agentId: string): boolean {
    const existing = this.locks.get(path);
    if (existing && existing.agentId !== agentId) {
      return false;
    }
    this.locks.set(path, { path, agentId, acquiredAt: Date.now() });
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
    for (const [path, lock] of this.locks) {
      if (lock.agentId === agentId) {
        this.locks.delete(path);
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
}
