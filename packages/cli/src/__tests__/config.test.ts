import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  getSkynetDir,
  ensureSkynetDir,
  listWorkspaces,
  addWorkspace,
  getWorkspace,
  getWorkspaceDir,
  getServerUrl,
  loadWorkspaceConfig,
} from '../config.js';

describe('config module', () => {
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

  it('getSkynetDir returns SKYNET_HOME when set', () => {
    expect(getSkynetDir()).toBe(tempDir);
  });

  it('listWorkspaces returns empty when no servers.json', () => {
    const workspaces = listWorkspaces();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces).toHaveLength(0);
  });

  it('getServerUrl formats URL correctly', () => {
    expect(getServerUrl({ id: '1', name: 'test', host: 'localhost', port: 4117 })).toBe('http://localhost:4117');
    expect(getServerUrl({ id: '1', name: 'test', host: '0.0.0.0', port: 9999 })).toBe('http://localhost:9999');
    expect(getServerUrl({ id: '1', name: 'test', host: '192.168.1.1', port: 4117 })).toBe('http://192.168.1.1:4117');
  });

  it('ensureSkynetDir creates directory in temp location', () => {
    ensureSkynetDir();
    expect(existsSync(tempDir)).toBe(true);
  });

  it('addWorkspace creates entry and workspace directory', () => {
    ensureSkynetDir();

    const entry = { id: randomUUID(), name: 'test-ws', host: 'localhost', port: 4117 };
    addWorkspace(entry);

    // Verify workspace dir was created
    expect(existsSync(getWorkspaceDir(entry.id))).toBe(true);
    expect(existsSync(join(getWorkspaceDir(entry.id), 'config.json'))).toBe(true);

    // Verify listing
    const workspaces = listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('test-ws');

    // Verify lookup by name and id
    const byName = getWorkspace('test-ws');
    expect(byName).toBeDefined();
    expect(byName!.id).toBe(entry.id);

    const byId = getWorkspace(entry.id);
    expect(byId).toBeDefined();
    expect(byId!.name).toBe('test-ws');
  });

  it('getWorkspace returns undefined for non-existent workspace', () => {
    ensureSkynetDir();
    expect(getWorkspace('nonexistent')).toBeUndefined();
  });

  it('addWorkspace supports multiple workspaces', () => {
    ensureSkynetDir();

    addWorkspace({ id: randomUUID(), name: 'ws-1', host: 'localhost', port: 4117 });
    addWorkspace({ id: randomUUID(), name: 'ws-2', host: 'localhost', port: 4118 });

    const workspaces = listWorkspaces();
    expect(workspaces).toHaveLength(2);
    expect(workspaces.map(w => w.name).sort()).toEqual(['ws-1', 'ws-2']);
  });

  it('loadWorkspaceConfig returns config after addWorkspace', () => {
    ensureSkynetDir();

    const id = randomUUID();
    addWorkspace({ id, name: 'cfg-ws', host: '192.168.1.1', port: 9999 });

    const config = loadWorkspaceConfig(id);
    expect(config).toBeDefined();
    expect(config!.host).toBe('192.168.1.1');
    expect(config!.port).toBe(9999);
  });

  it('loadWorkspaceConfig returns undefined for non-existent workspace', () => {
    ensureSkynetDir();
    expect(loadWorkspaceConfig('nonexistent')).toBeUndefined();
  });
});
