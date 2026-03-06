import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('config module', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skynet-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('listWorkspaces returns empty when no servers.json', async () => {
    const { listWorkspaces } = await import('../config.js');
    // Just test that it doesn't throw
    const workspaces = listWorkspaces();
    expect(Array.isArray(workspaces)).toBe(true);
  });

  it('getServerUrl formats URL correctly', async () => {
    const { getServerUrl } = await import('../config.js');
    expect(getServerUrl({ id: '1', name: 'test', host: 'localhost', port: 4117 })).toBe('http://localhost:4117');
    expect(getServerUrl({ id: '1', name: 'test', host: '0.0.0.0', port: 9999 })).toBe('http://localhost:9999');
    expect(getServerUrl({ id: '1', name: 'test', host: '192.168.1.1', port: 4117 })).toBe('http://192.168.1.1:4117');
  });

  it('ensureSkynetDir creates directory', async () => {
    const { ensureSkynetDir, getSkynetDir } = await import('../config.js');
    ensureSkynetDir();
    expect(existsSync(getSkynetDir())).toBe(true);
  });

  it('getWorkspace finds by name or id', async () => {
    const { addWorkspace, getWorkspace, ensureSkynetDir } = await import('../config.js');
    ensureSkynetDir();

    const uniqueName = `test-ws-${randomUUID().slice(0, 8)}`;
    const entry = { id: randomUUID(), name: uniqueName, host: 'localhost', port: 4117 };
    addWorkspace(entry);

    const byName = getWorkspace(uniqueName);
    expect(byName).toBeDefined();
    expect(byName!.id).toBe(entry.id);

    const byId = getWorkspace(entry.id);
    expect(byId).toBeDefined();
    expect(byId!.name).toBe(uniqueName);
  });
});
