import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

// Import the exported helpers for unit testing
import { parseSkillSpec, installSkills } from '../commands/agent.js';

// Mock execFileSync for installSkills tests
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

describe('parseSkillSpec', () => {
  it('parses source-only spec (GitHub shorthand)', () => {
    expect(parseSkillSpec('vercel-labs/agent-skills')).toEqual({
      source: 'vercel-labs/agent-skills',
    });
  });

  it('parses source with skill name', () => {
    expect(parseSkillSpec('vercel-labs/agent-skills:deploy-to-vercel')).toEqual({
      source: 'vercel-labs/agent-skills',
      skillName: 'deploy-to-vercel',
    });
  });

  it('parses full GitHub URL without skill name', () => {
    expect(parseSkillSpec('https://github.com/vercel-labs/agent-skills')).toEqual({
      source: 'https://github.com/vercel-labs/agent-skills',
    });
  });

  it('parses full GitHub URL with skill name', () => {
    expect(parseSkillSpec('https://github.com/vercel-labs/agent-skills:deploy-to-vercel')).toEqual({
      source: 'https://github.com/vercel-labs/agent-skills',
      skillName: 'deploy-to-vercel',
    });
  });

  it('parses local path with skill name', () => {
    expect(parseSkillSpec('./local-skills:code-review')).toEqual({
      source: './local-skills',
      skillName: 'code-review',
    });
  });

  it('parses local path without skill name', () => {
    expect(parseSkillSpec('./local-skills')).toEqual({
      source: './local-skills',
    });
  });

  it('handles trailing colon as no skill name', () => {
    expect(parseSkillSpec('vercel-labs/agent-skills:')).toEqual({
      source: 'vercel-labs/agent-skills',
    });
  });
});

describe('installSkills', () => {
  let tmpDir: string;
  let mockExecFileSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `skynet-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });

    const cp = await import('node:child_process');
    mockExecFileSync = cp.execFileSync as unknown as ReturnType<typeof vi.fn>;
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does nothing when specs is empty', async () => {
    await installSkills([], 'claude-code', tmpDir);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('calls npx skills add with correct args for source-only spec', async () => {
    await installSkills(['vercel-labs/agent-skills'], 'claude-code', tmpDir);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['skills', 'add', 'vercel-labs/agent-skills', '-a', 'claude-code', '-y'],
      { cwd: tmpDir, stdio: 'inherit' },
    );
  });

  it('calls npx skills add with -s flag for skill-specific spec', async () => {
    await installSkills(['vercel-labs/agent-skills:deploy-to-vercel'], 'claude-code', tmpDir);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['skills', 'add', 'vercel-labs/agent-skills', '-a', 'claude-code', '-y', '-s', 'deploy-to-vercel'],
      { cwd: tmpDir, stdio: 'inherit' },
    );
  });

  it('maps gemini-cli agent type correctly', async () => {
    await installSkills(['owner/repo'], 'gemini-cli', tmpDir);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['skills', 'add', 'owner/repo', '-a', 'gemini-cli', '-y'],
      { cwd: tmpDir, stdio: 'inherit' },
    );
  });

  it('falls back to claude-code for generic agent type', async () => {
    await installSkills(['owner/repo'], 'generic', tmpDir);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['skills', 'add', 'owner/repo', '-a', 'claude-code', '-y'],
      { cwd: tmpDir, stdio: 'inherit' },
    );
  });

  it('installs multiple skills sequentially', async () => {
    await installSkills(['owner/repo:skill-a', 'other/repo'], 'claude-code', tmpDir);
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'npx',
      ['skills', 'add', 'owner/repo', '-a', 'claude-code', '-y', '-s', 'skill-a'],
      { cwd: tmpDir, stdio: 'inherit' },
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'npx',
      ['skills', 'add', 'other/repo', '-a', 'claude-code', '-y'],
      { cwd: tmpDir, stdio: 'inherit' },
    );
  });

  it('warns but does not throw on install failure', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('npx not found'); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await installSkills(['bad/repo'], 'claude-code', tmpDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to install skill'));
    warnSpy.mockRestore();
  });
});

describe('agent new --skills flag parsing', () => {
  it('parses single --skills flag', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedOpts: Record<string, unknown> = {};

    const agent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <name-or-id>', 'Workspace name or UUID');

    agent
      .command('new')
      .option('--name <name>', 'Agent name')
      .option('--type <type>', 'Agent type')
      .option('--skills <spec...>', 'Install skills')
      .action((opts: Record<string, unknown>) => {
        capturedOpts = opts;
      });

    program.parse(['node', 'test', 'agent', 'new', '--name', 'bot', '--type', 'claude-code', '--skills', 'owner/repo:my-skill']);
    expect(capturedOpts.skills).toEqual(['owner/repo:my-skill']);
  });

  it('parses multiple --skills values', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedOpts: Record<string, unknown> = {};

    const agent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <name-or-id>', 'Workspace name or UUID');

    agent
      .command('new')
      .option('--name <name>', 'Agent name')
      .option('--type <type>', 'Agent type')
      .option('--skills <spec...>', 'Install skills')
      .action((opts: Record<string, unknown>) => {
        capturedOpts = opts;
      });

    program.parse(['node', 'test', 'agent', 'new', '--name', 'bot', '--type', 'claude-code', '--skills', 'owner/repo:skill-a', 'other/repo']);
    expect(capturedOpts.skills).toEqual(['owner/repo:skill-a', 'other/repo']);
  });

  it('defaults to undefined when --skills is not provided', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedOpts: Record<string, unknown> = {};

    const agent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <name-or-id>', 'Workspace name or UUID');

    agent
      .command('new')
      .option('--name <name>', 'Agent name')
      .option('--type <type>', 'Agent type')
      .option('--skills <spec...>', 'Install skills')
      .action((opts: Record<string, unknown>) => {
        capturedOpts = opts;
      });

    program.parse(['node', 'test', 'agent', 'new', '--name', 'bot', '--type', 'claude-code']);
    expect(capturedOpts.skills).toBeUndefined();
  });
});
