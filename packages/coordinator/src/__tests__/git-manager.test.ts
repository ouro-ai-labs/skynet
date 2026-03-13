import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitManager } from '../git-manager.js';

vi.mock('execa', () => ({
  execaCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

describe('GitManager', () => {
  let gm: GitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    gm = new GitManager('/repo');
  });

  // ── createWorktree ──

  describe('createWorktree', () => {
    it('runs git worktree add and returns worktree info', async () => {
      const { execaCommand } = await import('execa');
      const info = await gm.createWorktree('agent-1', 'feat/cool');

      expect(execaCommand).toHaveBeenCalledWith(
        expect.stringContaining('git worktree add'),
        { cwd: '/repo' },
      );
      expect(info.branch).toBe('feat/cool');
      expect(info.agentId).toBe('agent-1');
      expect(info.path).toContain('skynet-worktree-feat/cool');
    });

    it('stores the worktree so it can be retrieved later', async () => {
      await gm.createWorktree('agent-1', 'feat/a');
      const stored = gm.getWorktree('agent-1');
      expect(stored).toBeDefined();
      expect(stored!.branch).toBe('feat/a');
    });

    it('propagates errors from git', async () => {
      const { execaCommand } = await import('execa');
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('fatal: branch already exists'),
      );

      await expect(gm.createWorktree('agent-1', 'existing')).rejects.toThrow(
        'fatal: branch already exists',
      );
    });

    it('does not store worktree when git command fails', async () => {
      const { execaCommand } = await import('execa');
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('git error'),
      );

      await expect(gm.createWorktree('agent-1', 'bad')).rejects.toThrow();
      expect(gm.getWorktree('agent-1')).toBeUndefined();
    });
  });

  // ── removeWorktree ──

  describe('removeWorktree', () => {
    it('runs git worktree remove and clears the entry', async () => {
      const { execaCommand } = await import('execa');
      await gm.createWorktree('agent-1', 'feat/remove-me');
      vi.clearAllMocks();

      await gm.removeWorktree('agent-1');

      expect(execaCommand).toHaveBeenCalledWith(
        expect.stringContaining('git worktree remove'),
        { cwd: '/repo' },
      );
      expect(gm.getWorktree('agent-1')).toBeUndefined();
    });

    it('silently returns when agent has no worktree', async () => {
      const { execaCommand } = await import('execa');
      await gm.removeWorktree('nonexistent');

      expect(execaCommand).not.toHaveBeenCalled();
    });

    it('propagates errors from git worktree remove', async () => {
      const { execaCommand } = await import('execa');
      await gm.createWorktree('agent-1', 'feat/x');
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('fatal: not a valid directory'),
      );

      await expect(gm.removeWorktree('agent-1')).rejects.toThrow(
        'fatal: not a valid directory',
      );
    });
  });

  // ── mergeWorktree ──

  describe('mergeWorktree', () => {
    it('returns success when merge succeeds', async () => {
      await gm.createWorktree('agent-1', 'feat/merge-me');
      const result = await gm.mergeWorktree('agent-1');
      expect(result).toEqual({ success: true });
    });

    it('uses the default target branch (main)', async () => {
      const { execaCommand } = await import('execa');
      await gm.createWorktree('agent-1', 'feat/m');
      vi.clearAllMocks();

      await gm.mergeWorktree('agent-1');

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('git merge feat/m');
      expect(cmd).toContain('--no-ff');
    });

    it('throws when agent has no worktree', async () => {
      await expect(gm.mergeWorktree('ghost')).rejects.toThrow(
        'No worktree for agent: ghost',
      );
    });

    it('returns conflicts and aborts merge on conflict', async () => {
      const { execaCommand } = await import('execa');
      await gm.createWorktree('agent-1', 'feat/conflict');

      // First call (merge) fails, second call (diff) returns conflicting files, third call (abort) succeeds
      (execaCommand as unknown as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('CONFLICT'))
        .mockResolvedValueOnce({ stdout: 'src/a.ts\nsrc/b.ts', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await gm.mergeWorktree('agent-1');

      expect(result.success).toBe(false);
      expect(result.conflicts).toEqual(['src/a.ts', 'src/b.ts']);

      // Verify merge --abort was called
      const calls = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[calls.length - 1][0]).toBe('git merge --abort');
    });

    it('returns empty conflicts array when error is not a file conflict', async () => {
      const { execaCommand } = await import('execa');
      await gm.createWorktree('agent-1', 'feat/err');

      (execaCommand as unknown as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('merge failed'))
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await gm.mergeWorktree('agent-1');

      expect(result.success).toBe(false);
      expect(result.conflicts).toEqual([]);
    });
  });

  // ── listWorktrees ──

  describe('listWorktrees', () => {
    it('returns all registered worktrees', async () => {
      await gm.createWorktree('agent-1', 'feat/a');
      await gm.createWorktree('agent-2', 'feat/b');

      const list = gm.listWorktrees();
      expect(list).toHaveLength(2);
      expect(list.map(w => w.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    });

    it('returns empty array when no worktrees exist', () => {
      expect(gm.listWorktrees()).toEqual([]);
    });
  });
});
