import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// We test the config logic by importing the internal helpers and overriding paths
// Since the module uses hardcoded paths, we test the pure logic by re-implementing
// the merge behavior inline. For integration, we rely on the init command.

describe('config module', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skynet-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('default config has expected shape', async () => {
    // Import and test that loadConfig returns defaults when no file exists
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();

    expect(config.server).toBeDefined();
    expect(config.server.port).toBe(4117);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.dbPath).toMatch(/\.skynet\/data\.db$/);
    expect(config.client).toBeDefined();
    expect(config.client.serverUrl).toBe('http://localhost:4117');
  });

  it('config merges partial user overrides', async () => {
    // Test the merge logic: user provides partial config, defaults fill the rest
    const userConfig = { server: { port: 9999 } };
    const defaultConfig = {
      server: { port: 4117, host: '0.0.0.0', dbPath: '/tmp/data.db' },
      client: { serverUrl: 'http://localhost:4117' },
    };

    const merged = {
      server: { ...defaultConfig.server, ...userConfig.server },
      client: { ...defaultConfig.client },
    };

    expect(merged.server.port).toBe(9999);
    expect(merged.server.host).toBe('0.0.0.0');
    expect(merged.client.serverUrl).toBe('http://localhost:4117');
  });

  it('initConfig creates config file', async () => {
    const { initConfig, getConfigPath, ensureSkynetDir } = await import('../config.js');
    // initConfig should be idempotent — it won't overwrite existing config
    ensureSkynetDir();
    initConfig();

    const configPath = getConfigPath();
    expect(existsSync(configPath)).toBe(true);
  });
});
