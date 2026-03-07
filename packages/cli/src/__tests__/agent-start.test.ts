import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('agent start subcommand', () => {
  it('captures positional <name-or-id> argument', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedNameOrId: string | undefined;
    let capturedOpts: Record<string, unknown> = {};

    const agent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <name-or-id>', 'Workspace name or UUID');

    agent
      .command('start <name-or-id>')
      .description('Start an agent by name or UUID')
      .option('--workspace <name-or-id>', 'Workspace name or UUID')
      .action((nameOrId: string, opts: Record<string, unknown>) => {
        capturedNameOrId = nameOrId;
        capturedOpts = opts;
      });

    program.parse(['node', 'test', 'agent', 'start', 'my-agent']);
    expect(capturedNameOrId).toBe('my-agent');
  });

  it('passes --workspace flag through to start subcommand', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedNameOrId: string | undefined;
    let capturedOpts: Record<string, unknown> = {};

    const agent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <name-or-id>', 'Workspace name or UUID');

    agent
      .command('start <name-or-id>')
      .description('Start an agent by name or UUID')
      .option('--workspace <name-or-id>', 'Workspace name or UUID')
      .action((nameOrId: string, opts: Record<string, unknown>) => {
        capturedNameOrId = nameOrId;
        capturedOpts = opts;
      });

    program.parse(['node', 'test', 'agent', 'start', 'backend', '--workspace', 'ws-uuid-123']);
    expect(capturedNameOrId).toBe('backend');
    expect(capturedOpts.workspace).toBe('ws-uuid-123');
  });

  it('accepts UUID-style name-or-id', () => {
    const program = new Command();
    program.enablePositionalOptions();

    let capturedNameOrId: string | undefined;

    const agent = program
      .command('agent')
      .enablePositionalOptions()
      .passThroughOptions()
      .option('--workspace <name-or-id>', 'Workspace name or UUID');

    agent
      .command('start <name-or-id>')
      .description('Start an agent by name or UUID')
      .option('--workspace <name-or-id>', 'Workspace name or UUID')
      .action((nameOrId: string) => {
        capturedNameOrId = nameOrId;
      });

    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    program.parse(['node', 'test', 'agent', 'start', uuid]);
    expect(capturedNameOrId).toBe(uuid);
  });
});
