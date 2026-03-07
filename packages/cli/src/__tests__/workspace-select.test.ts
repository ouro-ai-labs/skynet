import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { ensureSkynetDir, addWorkspace } from '../config.js';
import { selectWorkspace } from '../utils/workspace-select.js';

describe('selectWorkspace', () => {
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

  it('returns workspace when --workspace matches an ID', () => {
    ensureSkynetDir();
    const id = randomUUID();
    addWorkspace({ id, name: 'test-ws', host: 'localhost', port: 4117 });

    const result = selectWorkspace({ workspace: id });
    expect(result.id).toBe(id);
    expect(result.name).toBe('test-ws');
  });

  it('returns the only workspace when no --workspace is given', () => {
    ensureSkynetDir();
    const id = randomUUID();
    addWorkspace({ id, name: 'solo', host: 'localhost', port: 4117 });

    const result = selectWorkspace({});
    expect(result.id).toBe(id);
  });

  it('exits when --workspace ID is not found', () => {
    ensureSkynetDir();
    addWorkspace({ id: randomUUID(), name: 'ws', host: 'localhost', port: 4117 });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => selectWorkspace({ workspace: 'nonexistent' })).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits when multiple workspaces exist and no --workspace is given', () => {
    ensureSkynetDir();
    addWorkspace({ id: randomUUID(), name: 'ws-1', host: 'localhost', port: 4117 });
    addWorkspace({ id: randomUUID(), name: 'ws-2', host: 'localhost', port: 4118 });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => selectWorkspace({})).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('Commander --workspace option passing to subcommands', () => {
  it('passes --workspace to subcommand when parent uses passThroughOptions', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedOpts: Record<string, unknown> = {};

    const parent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <id>', 'Workspace UUID');

    parent
      .command('new')
      .option('--workspace <id>', 'Workspace UUID')
      .action((opts) => { capturedOpts = opts; });

    program.parse(['node', 'test', 'agent', 'new', '--workspace', 'abc-123']);
    expect(capturedOpts.workspace).toBe('abc-123');
  });

  it('fails to pass --workspace to subcommand without passThroughOptions', () => {
    const program = new Command();

    let capturedOpts: Record<string, unknown> = {};

    const parent = program
      .command('agent')
      .option('--workspace <id>', 'Workspace UUID');

    parent
      .command('new')
      .option('--workspace <id>', 'Workspace UUID')
      .action((opts) => { capturedOpts = opts; });

    program.parse(['node', 'test', 'agent', 'new', '--workspace', 'abc-123']);
    // Without passThroughOptions, the parent consumes --workspace
    expect(capturedOpts.workspace).toBeUndefined();
  });
});
