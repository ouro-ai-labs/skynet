import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { Command } from 'commander';
import { listWorkspaces } from '../config.js';
import { getPidFilePath, getRunningPid } from '../daemon.js';

const DEFAULT_PORT = 4117;

interface CheckResult {
  ok: boolean;
  label: string;
  detail?: string;
}

/**
 * Run a command and return its trimmed stdout, or null on failure.
 */
function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Parse a semver-like version string (e.g. "v20.11.0" or "20.11.0") into a major number.
 */
function parseMajor(version: string): number | null {
  const match = /(\d+)/.exec(version);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if a TCP port is available (nothing listening).
 * Returns true if available, false if in use.
 */
function checkPort(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(false); // port in use
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(true); // port available
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(true); // port available (no response)
    });
  });
}

export function checkNodeVersion(): CheckResult {
  const raw = tryExec('node', ['--version']);
  if (!raw) {
    return { ok: false, label: 'Node.js', detail: 'not found' };
  }
  const major = parseMajor(raw);
  if (major === null) {
    return { ok: false, label: 'Node.js', detail: `unknown version: ${raw}` };
  }
  if (major < 20) {
    return { ok: false, label: `Node.js ${raw} (>=20 required)`, detail: 'upgrade Node.js to v20 or later' };
  }
  return { ok: true, label: `Node.js ${raw} (>=20 required)` };
}

export function checkPnpm(): CheckResult {
  const raw = tryExec('pnpm', ['--version']);
  if (!raw) {
    return { ok: false, label: 'pnpm (not found — install: https://pnpm.io/installation)' };
  }
  return { ok: true, label: `pnpm ${raw}` };
}

export function checkGit(): CheckResult {
  const raw = tryExec('git', ['--version']);
  if (!raw) {
    return { ok: false, label: 'git (not found)' };
  }
  const versionMatch = /(\d+\.\d+\.\d+)/.exec(raw);
  const version = versionMatch ? versionMatch[1] : 'unknown';

  // Check worktree support (available since git 2.5)
  const worktreeHelp = tryExec('git', ['worktree', 'list', '--porcelain']);
  const worktreeSupport = worktreeHelp !== null;
  const suffix = worktreeSupport ? 'worktree support: yes' : 'worktree support: no';

  return { ok: true, label: `git ${version} (${suffix})` };
}

interface AgentCliInfo {
  cmd: string;
  name: string;
  installHint: string;
}

const AGENT_CLIS: AgentCliInfo[] = [
  { cmd: 'claude', name: 'Claude Code CLI', installHint: 'npm i -g @anthropic-ai/claude-code' },
  { cmd: 'gemini', name: 'Gemini CLI', installHint: 'npm i -g @google/gemini-cli' },
  { cmd: 'codex', name: 'Codex CLI', installHint: 'npm i -g @openai/codex' },
];

export function checkAgentCli(info: AgentCliInfo): CheckResult {
  const found = tryExec(info.cmd, ['--version']);
  if (found) {
    return { ok: true, label: `${info.cmd} (${info.name})` };
  }
  return { ok: false, label: `${info.cmd} (not found — install: ${info.installHint})` };
}

export function checkRunningWorkspaces(): CheckResult[] {
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    return [{ ok: true, label: 'No workspaces configured' }];
  }

  const results: CheckResult[] = [];
  for (const ws of workspaces) {
    const pidFile = getPidFilePath(ws.id, 'server');
    const pid = getRunningPid(pidFile);
    if (pid) {
      results.push({ ok: true, label: `Workspace "${ws.name}" running on port ${ws.port} (pid: ${pid})` });
    } else {
      results.push({ ok: true, label: `Workspace "${ws.name}" (port ${ws.port}) — stopped` });
    }
  }
  return results;
}

export async function checkDefaultPort(port: number = DEFAULT_PORT): Promise<CheckResult> {
  const available = await checkPort(port);
  if (available) {
    return { ok: true, label: `No workspace running on port ${port}` };
  }
  return {
    ok: false,
    label: `Port ${port} is in use`,
    detail: `Another process is using port ${port}. Use --port to specify a different port.`,
  };
}

function formatResult(result: CheckResult): string {
  const icon = result.ok ? '\u2713' : '\u2717';
  return `${icon} ${result.label}`;
}

export async function runDoctor(): Promise<boolean> {
  let allOk = true;

  console.log('Skynet Doctor\n');

  // Node.js
  const nodeResult = checkNodeVersion();
  console.log(formatResult(nodeResult));
  if (!nodeResult.ok) allOk = false;

  // pnpm
  const pnpmResult = checkPnpm();
  console.log(formatResult(pnpmResult));
  if (!pnpmResult.ok) allOk = false;

  // git
  const gitResult = checkGit();
  console.log(formatResult(gitResult));
  if (!gitResult.ok) allOk = false;

  // Agent CLIs
  console.log('');
  for (const cli of AGENT_CLIS) {
    const result = checkAgentCli(cli);
    console.log(formatResult(result));
    // Missing agent CLIs are informational, not failures
  }

  // Running workspaces
  console.log('');
  const wsResults = checkRunningWorkspaces();
  for (const result of wsResults) {
    console.log(formatResult(result));
  }

  // Default port
  const portResult = await checkDefaultPort();
  console.log(formatResult(portResult));
  if (!portResult.ok) allOk = false;

  console.log('');
  if (allOk) {
    console.log('All checks passed.');
  } else {
    console.log('Some checks failed. See above for details.');
  }

  return allOk;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check system prerequisites and environment health')
    .action(async () => {
      const ok = await runDoctor();
      if (!ok) {
        process.exit(1);
      }
    });
}
