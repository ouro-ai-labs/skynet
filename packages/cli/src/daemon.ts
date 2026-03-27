import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getWorkspaceDir } from './config.js';

/**
 * Returns the pids directory for a workspace: ~/.skynet/<ws-id>/pids/
 */
function getPidsDir(workspaceId: string): string {
  return join(getWorkspaceDir(workspaceId), 'pids');
}

/**
 * Returns the PID file path for a workspace server, agent, or chat process.
 */
export function getPidFilePath(workspaceId: string, type: 'server' | 'agent' | 'chat', entityId?: string): string {
  const dir = getPidsDir(workspaceId);
  if (type === 'server') {
    return join(dir, 'server.pid');
  }
  if (!entityId) {
    throw new Error(`entityId is required for ${type} PID files`);
  }
  if (type === 'chat') {
    return join(dir, `chat-${entityId}.pid`);
  }
  return join(dir, `agent-${entityId}.pid`);
}

/**
 * Write a PID to a file, creating directories as needed.
 */
export function writePid(pidFile: string, pid: number): void {
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(pid), 'utf-8');
}

/**
 * Read a PID from a file. Returns null if the file does not exist or is invalid.
 */
export function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const content = readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove a PID file if it exists.
 */
export function removePid(pidFile: string): void {
  try {
    unlinkSync(pidFile);
  } catch {
    // Ignore if already removed
  }
}

/**
 * Check if a process with the given PID is running.
 */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID file and check if the process is still alive.
 * Returns the PID if running, null otherwise. Cleans up stale PID files.
 */
export function getRunningPid(pidFile: string): number | null {
  const pid = readPid(pidFile);
  if (pid === null) return null;
  if (isRunning(pid)) return pid;
  // Stale PID file — process no longer running
  removePid(pidFile);
  return null;
}

/**
 * Stop a process identified by a PID file.
 * Sends SIGTERM, waits for graceful shutdown, then SIGKILL if needed.
 * Returns true if the process was stopped, false if it was not running.
 */
export async function stopProcess(pidFile: string, timeoutMs = 5000): Promise<boolean> {
  const pid = readPid(pidFile);
  if (pid === null) return false;

  if (!isRunning(pid)) {
    removePid(pidFile);
    return false;
  }

  // Send SIGTERM for graceful shutdown
  process.kill(pid, 'SIGTERM');

  // Poll until process exits or timeout
  const start = Date.now();
  const pollInterval = 200;
  while (Date.now() - start < timeoutMs) {
    if (!isRunning(pid)) {
      removePid(pidFile);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Force kill if still running
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Process may have exited between check and kill
  }

  removePid(pidFile);
  return true;
}

/**
 * Spawn the daemon entry script as a detached background process.
 * Returns the child PID.
 */
export function spawnDaemon(args: string[], logFile: string): number {
  // Resolve the daemon-entry script path relative to this file
  const entryScript = join(dirname(new URL(import.meta.url).pathname), 'daemon-entry.js');

  const child = spawn(process.execPath, [entryScript, ...args], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  });

  child.unref();

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error('Failed to spawn daemon process');
  }
  return pid;
}
