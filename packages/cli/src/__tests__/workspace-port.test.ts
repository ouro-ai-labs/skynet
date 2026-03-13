import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  ensureSkynetDir,
  addWorkspace,
  findWorkspaceByPort,
  getNextAvailablePort,
} from '../config.js';

describe('workspace port conflict helpers', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skynet-test-${randomUUID()}`);
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

  describe('getNextAvailablePort', () => {
    it('returns startPort when no workspaces exist', () => {
      ensureSkynetDir();
      expect(getNextAvailablePort(4117)).toBe(4117);
    });

    it('returns next port when startPort is taken', () => {
      ensureSkynetDir();
      addWorkspace({ id: randomUUID(), name: 'ws-1', host: '0.0.0.0', port: 4117 });
      expect(getNextAvailablePort(4117)).toBe(4118);
    });

    it('skips multiple taken ports', () => {
      ensureSkynetDir();
      addWorkspace({ id: randomUUID(), name: 'ws-1', host: '0.0.0.0', port: 4117 });
      addWorkspace({ id: randomUUID(), name: 'ws-2', host: '0.0.0.0', port: 4118 });
      addWorkspace({ id: randomUUID(), name: 'ws-3', host: '0.0.0.0', port: 4119 });
      expect(getNextAvailablePort(4117)).toBe(4120);
    });

    it('returns startPort when only higher ports are taken', () => {
      ensureSkynetDir();
      addWorkspace({ id: randomUUID(), name: 'ws-1', host: '0.0.0.0', port: 4200 });
      expect(getNextAvailablePort(4117)).toBe(4117);
    });

    it('fills gaps in port assignments', () => {
      ensureSkynetDir();
      addWorkspace({ id: randomUUID(), name: 'ws-1', host: '0.0.0.0', port: 4117 });
      addWorkspace({ id: randomUUID(), name: 'ws-2', host: '0.0.0.0', port: 4119 });
      expect(getNextAvailablePort(4117)).toBe(4118);
    });
  });

  describe('findWorkspaceByPort', () => {
    it('returns undefined when no workspaces exist', () => {
      ensureSkynetDir();
      expect(findWorkspaceByPort(4117)).toBeUndefined();
    });

    it('returns matching workspace', () => {
      ensureSkynetDir();
      const id = randomUUID();
      addWorkspace({ id, name: 'my-ws', host: '0.0.0.0', port: 4117 });
      const result = findWorkspaceByPort(4117);
      expect(result).toBeDefined();
      expect(result!.name).toBe('my-ws');
      expect(result!.id).toBe(id);
    });

    it('returns undefined for non-matching port', () => {
      ensureSkynetDir();
      addWorkspace({ id: randomUUID(), name: 'my-ws', host: '0.0.0.0', port: 4117 });
      expect(findWorkspaceByPort(4118)).toBeUndefined();
    });
  });
});
