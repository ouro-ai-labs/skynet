import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  checkNodeVersion,
  checkPnpm,
  checkGit,
  checkAgentCli,
  checkRunningWorkspaces,
  checkDefaultPort,
  runDoctor,
} from '../commands/doctor.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:net', () => ({
  createConnection: vi.fn((_opts: unknown) => {
    const ee = {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        // Simulate connection refused (port available)
        if (event === 'error') {
          setTimeout(cb, 0);
        }
        return ee;
      }),
    };
    return ee;
  }),
}));

vi.mock('../config.js', () => ({
  listWorkspaces: vi.fn(() => []),
  getWorkspaceDir: vi.fn((id: string) => `/fake/.skynet/${id}`),
}));

vi.mock('../daemon.js', () => ({
  getPidFilePath: vi.fn((_wsId: string, _type: string) => '/fake/pid'),
  getRunningPid: vi.fn(() => null),
}));

const mockExecFileSync = vi.mocked(execFileSync);

function mockExec(results: Record<string, string | null>): void {
  mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
    const key = `${cmd} ${(args ?? []).join(' ')}`;
    for (const [pattern, value] of Object.entries(results)) {
      if (key.startsWith(pattern) || cmd === pattern) {
        if (value === null) throw new Error(`Command not found: ${cmd}`);
        return value;
      }
    }
    throw new Error(`Command not found: ${cmd}`);
  });
}

describe('doctor command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkNodeVersion', () => {
    it('returns ok for Node.js >=20', () => {
      mockExec({ 'node --version': 'v20.11.0' });
      const result = checkNodeVersion();
      expect(result.ok).toBe(true);
      expect(result.label).toContain('v20.11.0');
      expect(result.label).toContain('>=20 required');
    });

    it('returns ok for Node.js v22', () => {
      mockExec({ 'node --version': 'v22.1.0' });
      const result = checkNodeVersion();
      expect(result.ok).toBe(true);
    });

    it('returns not ok for Node.js <20', () => {
      mockExec({ 'node --version': 'v18.19.0' });
      const result = checkNodeVersion();
      expect(result.ok).toBe(false);
      expect(result.label).toContain('v18.19.0');
    });

    it('returns not ok when node is not found', () => {
      mockExec({ 'node': null });
      const result = checkNodeVersion();
      expect(result.ok).toBe(false);
      expect(result.label).toContain('Node.js');
    });
  });

  describe('checkPnpm', () => {
    it('returns ok when pnpm is available', () => {
      mockExec({ 'pnpm --version': '9.1.0' });
      const result = checkPnpm();
      expect(result.ok).toBe(true);
      expect(result.label).toContain('pnpm 9.1.0');
    });

    it('returns not ok when pnpm is not found', () => {
      mockExec({ 'pnpm': null });
      const result = checkPnpm();
      expect(result.ok).toBe(false);
      expect(result.label).toContain('not found');
      expect(result.label).toContain('install');
    });
  });

  describe('checkGit', () => {
    it('returns ok with version and worktree support', () => {
      mockExec({
        'git --version': 'git version 2.43.0',
        'git worktree': '',
      });
      const result = checkGit();
      expect(result.ok).toBe(true);
      expect(result.label).toContain('2.43.0');
      expect(result.label).toContain('worktree support: yes');
    });

    it('returns not ok when git is not found', () => {
      mockExec({ 'git': null });
      const result = checkGit();
      expect(result.ok).toBe(false);
      expect(result.label).toContain('not found');
    });
  });

  describe('checkAgentCli', () => {
    it('returns ok when agent CLI is found', () => {
      mockExec({ 'claude --version': '1.0.0' });
      const result = checkAgentCli({ cmd: 'claude', name: 'Claude Code CLI', installHint: 'npm i -g @anthropic-ai/claude-code' });
      expect(result.ok).toBe(true);
      expect(result.label).toContain('claude');
      expect(result.label).toContain('Claude Code CLI');
    });

    it('returns not ok with install hint when agent CLI is missing', () => {
      mockExec({ 'gemini': null });
      const result = checkAgentCli({ cmd: 'gemini', name: 'Gemini CLI', installHint: 'npm i -g @google/gemini-cli' });
      expect(result.ok).toBe(false);
      expect(result.label).toContain('not found');
      expect(result.label).toContain('npm i -g @google/gemini-cli');
    });
  });

  describe('checkRunningWorkspaces', () => {
    it('reports no workspaces configured', () => {
      const results = checkRunningWorkspaces();
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(true);
      expect(results[0].label).toContain('No workspaces configured');
    });

    it('reports configured workspaces', async () => {
      const { listWorkspaces } = await import('../config.js');
      vi.mocked(listWorkspaces).mockReturnValue([
        { id: 'ws-1', name: 'test', host: '0.0.0.0', port: 4117 },
      ]);

      const results = checkRunningWorkspaces();
      expect(results).toHaveLength(1);
      expect(results[0].label).toContain('test');
      expect(results[0].label).toContain('stopped');
    });

    it('reports running workspaces with pid', async () => {
      const { listWorkspaces } = await import('../config.js');
      vi.mocked(listWorkspaces).mockReturnValue([
        { id: 'ws-1', name: 'test', host: '0.0.0.0', port: 4117 },
      ]);
      const { getRunningPid } = await import('../daemon.js');
      vi.mocked(getRunningPid).mockReturnValue(12345);

      const results = checkRunningWorkspaces();
      expect(results).toHaveLength(1);
      expect(results[0].label).toContain('running');
      expect(results[0].label).toContain('12345');
    });
  });

  describe('checkDefaultPort', () => {
    it('reports port as available when connection is refused', async () => {
      // Use a port that's very unlikely to be in use
      const result = await checkDefaultPort(59999);
      expect(result.ok).toBe(true);
      expect(result.label).toContain('59999');
    });
  });

  describe('runDoctor', () => {
    it('produces output with check marks for all-good scenario', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '));
      });

      // Reset mocks to default (no workspaces, no running pids)
      const { listWorkspaces } = await import('../config.js');
      vi.mocked(listWorkspaces).mockReturnValue([]);
      const { getRunningPid } = await import('../daemon.js');
      vi.mocked(getRunningPid).mockReturnValue(null);

      mockExec({
        'node --version': 'v20.11.0',
        'pnpm --version': '9.1.0',
        'git --version': 'git version 2.43.0',
        'git worktree': '',
        'claude --version': '1.0.0',
        'gemini --version': '1.0.0',
        'codex --version': '1.0.0',
      });

      const ok = await runDoctor();

      const output = logs.join('\n');
      expect(output).toContain('\u2713 Node.js v20.11.0');
      expect(output).toContain('\u2713 pnpm 9.1.0');
      expect(output).toContain('\u2713 git 2.43.0');
      expect(output).toContain('\u2713 claude (Claude Code CLI)');
      expect(output).toContain('\u2713 gemini (Gemini CLI)');
      expect(output).toContain('\u2713 codex (Codex CLI)');
      expect(output).toContain('All checks passed');
      expect(ok).toBe(true);
    });

    it('produces output with crosses when tools are missing', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '));
      });

      // Only node works, everything else fails
      mockExec({
        'node --version': 'v20.11.0',
        'pnpm': null,
        'git': null,
        'claude': null,
        'gemini': null,
        'codex': null,
      });

      const ok = await runDoctor();

      const output = logs.join('\n');
      expect(output).toContain('\u2713 Node.js v20.11.0');
      expect(output).toContain('\u2717 pnpm');
      expect(output).toContain('\u2717 git');
      expect(output).toContain('\u2717 claude');
      expect(output).toContain('\u2717 gemini');
      expect(output).toContain('\u2717 codex');
      expect(output).toContain('Some checks failed');
      expect(ok).toBe(false);
    });

    it('reports old Node.js version as failure', async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '));
      });

      mockExec({
        'node --version': 'v18.0.0',
        'pnpm --version': '9.0.0',
        'git --version': 'git version 2.40.0',
        'git worktree': '',
        'claude': null,
        'gemini': null,
        'codex': null,
      });

      const ok = await runDoctor();

      const output = logs.join('\n');
      expect(output).toContain('\u2717 Node.js v18.0.0');
      expect(ok).toBe(false);
    });
  });
});
