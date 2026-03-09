import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { AgentType } from '@skynet-ai/protocol';
import { registerStatusCommand } from '../commands/status.js';

// Mock workspace-select so we don't need real config
vi.mock('../utils/workspace-select.js', () => ({
  selectWorkspace: () => ({ id: 'ws-1', name: 'test-workspace', host: 'localhost', port: 4117 }),
  getServerUrl: () => 'http://localhost:4117',
}));

function makeFetchResponse(data: unknown): Response {
  return { json: () => Promise.resolve(data) } as Response;
}

describe('status command', () => {
  let logs: string[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('shows agents with id, type, role, persona, and online status', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse([
        // Connected members: agent-1 is online and busy
        { id: 'a1', name: 'claude-1', type: AgentType.CLAUDE_CODE, status: 'busy' },
      ]))
      .mockResolvedValueOnce(makeFetchResponse([
        // Registered agents (API now includes runtime status)
        { id: 'a1', name: 'claude-1', type: AgentType.CLAUDE_CODE, role: 'backend', persona: 'Careful and thorough', status: 'busy' },
        { id: 'a2', name: 'gemini-1', type: AgentType.GEMINI_CLI, role: 'frontend', status: 'offline' },
      ]))
      .mockResolvedValueOnce(makeFetchResponse([]));

    const program = new Command();
    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    const output = logs.join('\n');

    // Agent 1 should be busy (online)
    expect(output).toContain('claude-1 [busy]');
    expect(output).toContain('id: a1 | type: claude-code | role: backend | persona: Careful and thorough');

    // Agent 2 should be offline (not in members)
    expect(output).toContain('gemini-1 [offline]');
    expect(output).toContain('id: a2 | type: gemini-cli | role: frontend');
  });

  it('shows humans with id and online status', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse([
        { id: 'h1', name: 'alice', type: AgentType.HUMAN, status: 'idle' },
      ]))
      .mockResolvedValueOnce(makeFetchResponse([]))
      .mockResolvedValueOnce(makeFetchResponse([
        { id: 'h1', name: 'alice', createdAt: 1000 },
        { id: 'h2', name: 'bob', createdAt: 2000 },
      ]));

    const program = new Command();
    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    const output = logs.join('\n');

    expect(output).toContain('alice [online]');
    expect(output).toContain('id: h1');
    expect(output).toContain('bob [offline]');
    expect(output).toContain('id: h2');
  });

  it('shows (none) when no agents or humans', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse([]))
      .mockResolvedValueOnce(makeFetchResponse([]))
      .mockResolvedValueOnce(makeFetchResponse([]));

    const program = new Command();
    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    const output = logs.join('\n');
    expect(output).toContain('Agents (0):');
    expect(output).toContain('(none)');
    expect(output).toContain('Humans (0):');
  });

  it('truncates long persona text', async () => {
    const longPersona = 'A'.repeat(100);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse([]))
      .mockResolvedValueOnce(makeFetchResponse([
        { id: 'a1', name: 'agent-1', type: AgentType.GENERIC, persona: longPersona, status: 'offline' },
      ]))
      .mockResolvedValueOnce(makeFetchResponse([]));

    const program = new Command();
    registerStatusCommand(program);
    await program.parseAsync(['status'], { from: 'user' });

    const output = logs.join('\n');
    // Persona should be truncated to 60 chars (59 + '…')
    expect(output).toContain('persona: ' + 'A'.repeat(59) + '…');
    expect(output).not.toContain('A'.repeat(100));
  });
});
