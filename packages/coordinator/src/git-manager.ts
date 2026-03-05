import { execaCommand } from 'execa';
import { join } from 'node:path';

export interface WorktreeInfo {
  path: string;
  branch: string;
  agentId: string;
}

export class GitManager {
  private worktrees = new Map<string, WorktreeInfo>();

  constructor(private repoRoot: string) {}

  async createWorktree(agentId: string, branchName: string): Promise<WorktreeInfo> {
    const worktreePath = join(this.repoRoot, '..', `skynet-worktree-${branchName}`);

    await execaCommand(`git worktree add ${worktreePath} -b ${branchName}`, {
      cwd: this.repoRoot,
    });

    const info: WorktreeInfo = { path: worktreePath, branch: branchName, agentId };
    this.worktrees.set(agentId, info);
    return info;
  }

  async removeWorktree(agentId: string): Promise<void> {
    const info = this.worktrees.get(agentId);
    if (!info) return;

    await execaCommand(`git worktree remove ${info.path} --force`, {
      cwd: this.repoRoot,
    });
    this.worktrees.delete(agentId);
  }

  async mergeWorktree(agentId: string, targetBranch: string = 'main'): Promise<{ success: boolean; conflicts?: string[] }> {
    const info = this.worktrees.get(agentId);
    if (!info) throw new Error(`No worktree for agent: ${agentId}`);

    try {
      await execaCommand(`git merge ${info.branch} --no-ff -m "Merge ${info.branch} from agent ${agentId}"`, {
        cwd: this.repoRoot,
      });
      return { success: true };
    } catch (err) {
      // Check for conflicts
      const { stdout } = await execaCommand('git diff --name-only --diff-filter=U', {
        cwd: this.repoRoot,
      });
      const conflicts = stdout.split('\n').filter(Boolean);

      // Abort the merge
      await execaCommand('git merge --abort', { cwd: this.repoRoot });

      return { success: false, conflicts };
    }
  }

  getWorktree(agentId: string): WorktreeInfo | undefined {
    return this.worktrees.get(agentId);
  }

  listWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }
}
