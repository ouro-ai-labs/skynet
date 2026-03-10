import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import {
  writePid,
  readPid,
  removePid,
  isRunning,
  getRunningPid,
  stopProcess,
  getPidFilePath,
} from '../daemon.js';

describe('daemon module', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skynet-daemon-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    originalHome = process.env.SKYNET_HOME;
    process.env.SKYNET_HOME = tempDir;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.SKYNET_HOME;
    } else {
      process.env.SKYNET_HOME = originalHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getPidFilePath', () => {
    it('returns server PID path for workspace', () => {
      const wsId = 'test-ws-id';
      const pidPath = getPidFilePath(wsId, 'server');
      expect(pidPath).toBe(join(tempDir, wsId, 'pids', 'server.pid'));
    });

    it('returns agent PID path with agent ID', () => {
      const wsId = 'test-ws-id';
      const agentId = 'agent-123';
      const pidPath = getPidFilePath(wsId, 'agent', agentId);
      expect(pidPath).toBe(join(tempDir, wsId, 'pids', `agent-${agentId}.pid`));
    });

    it('throws when agent type used without agentId', () => {
      expect(() => getPidFilePath('ws-id', 'agent')).toThrow('agentId is required');
    });
  });

  describe('writePid / readPid', () => {
    it('writes and reads a PID', () => {
      const pidFile = join(tempDir, 'test.pid');
      writePid(pidFile, 12345);
      expect(readPid(pidFile)).toBe(12345);
    });

    it('creates intermediate directories', () => {
      const pidFile = join(tempDir, 'a', 'b', 'test.pid');
      writePid(pidFile, 99);
      expect(existsSync(pidFile)).toBe(true);
      expect(readPid(pidFile)).toBe(99);
    });

    it('returns null for non-existent file', () => {
      expect(readPid(join(tempDir, 'nope.pid'))).toBeNull();
    });

    it('returns null for invalid content', () => {
      const pidFile = join(tempDir, 'bad.pid');
      const { writeFileSync } = require('node:fs');
      writeFileSync(pidFile, 'not-a-number', 'utf-8');
      expect(readPid(pidFile)).toBeNull();
    });
  });

  describe('removePid', () => {
    it('removes an existing PID file', () => {
      const pidFile = join(tempDir, 'remove.pid');
      writePid(pidFile, 1);
      expect(existsSync(pidFile)).toBe(true);
      removePid(pidFile);
      expect(existsSync(pidFile)).toBe(false);
    });

    it('does not throw for non-existent file', () => {
      expect(() => removePid(join(tempDir, 'nope.pid'))).not.toThrow();
    });
  });

  describe('isRunning', () => {
    it('returns true for current process', () => {
      expect(isRunning(process.pid)).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      // Use a very high PID that's unlikely to exist
      expect(isRunning(999999999)).toBe(false);
    });
  });

  describe('getRunningPid', () => {
    it('returns PID when process is running', () => {
      const pidFile = join(tempDir, 'running.pid');
      writePid(pidFile, process.pid);
      expect(getRunningPid(pidFile)).toBe(process.pid);
    });

    it('returns null and cleans up stale PID file', () => {
      const pidFile = join(tempDir, 'stale.pid');
      writePid(pidFile, 999999999);
      expect(getRunningPid(pidFile)).toBeNull();
      // PID file should be cleaned up
      expect(existsSync(pidFile)).toBe(false);
    });

    it('returns null when no PID file exists', () => {
      expect(getRunningPid(join(tempDir, 'nope.pid'))).toBeNull();
    });
  });

  describe('stopProcess', () => {
    it('returns false when no PID file exists', async () => {
      const result = await stopProcess(join(tempDir, 'nope.pid'));
      expect(result).toBe(false);
    });

    it('returns false and cleans up stale PID file', async () => {
      const pidFile = join(tempDir, 'stale.pid');
      writePid(pidFile, 999999999);
      const result = await stopProcess(pidFile);
      expect(result).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
    });

    it('stops a real background process', async () => {
      // Spawn a long-running sleep process
      const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
      child.unref();
      const pid = child.pid!;

      const pidFile = join(tempDir, 'child.pid');
      writePid(pidFile, pid);

      expect(isRunning(pid)).toBe(true);

      const result = await stopProcess(pidFile, 3000);
      expect(result).toBe(true);
      expect(existsSync(pidFile)).toBe(false);

      // Give OS a moment to clean up
      await new Promise((r) => setTimeout(r, 100));
      expect(isRunning(pid)).toBe(false);
    });
  });
});
