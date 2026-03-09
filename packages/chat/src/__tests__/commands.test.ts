import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCommand } from '../commands.js';

const mockAgents = [
  { id: 'agent-001-abc', name: 'alice', type: 'claude', status: 'idle' },
  { id: 'agent-002-def', name: 'bob', type: 'gemini', status: 'busy' },
];

function mockFetch(responses: Array<{ ok: boolean; body: unknown }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++] ?? { ok: true, body: {} };
    return {
      ok: resp.ok,
      json: async () => resp.body,
    };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('executeCommand', () => {
  it('returns null for unknown commands', async () => {
    const result = await executeCommand('http://localhost', '/unknown');
    expect(result).toBeNull();
  });

  it('/agent list returns agent list with status indicators', async () => {
    globalThis.fetch = mockFetch([{ ok: true, body: mockAgents }]) as unknown as typeof fetch;
    const result = await executeCommand('http://localhost', '/agent list');
    expect(result?.lines[0]).toContain('Agents (2)');
    // idle agent shows green circle
    expect(result?.lines[1]).toContain('\u{1F7E2}');
    expect(result?.lines[1]).toContain('alice');
    // busy agent shows yellow circle
    expect(result?.lines[2]).toContain('\u{1F7E1}');
    expect(result?.lines[2]).toContain('bob');
  });

  it('/agent list shows offline indicator for agents without status', async () => {
    const offlineAgents = [
      { id: 'agent-003-ghi', name: 'charlie', type: 'generic', status: 'offline' },
    ];
    globalThis.fetch = mockFetch([{ ok: true, body: offlineAgents }]) as unknown as typeof fetch;
    const result = await executeCommand('http://localhost', '/agent list');
    expect(result?.lines[1]).toContain('\u26AB');
    expect(result?.lines[1]).toContain('charlie');
  });

  it('/agent interrupt accepts bare name', async () => {
    globalThis.fetch = mockFetch([
      { ok: true, body: mockAgents },
      { ok: true, body: {} },
    ]) as unknown as typeof fetch;
    const result = await executeCommand('http://localhost', '/agent interrupt alice');
    expect(result?.error).toBeUndefined();
    expect(result?.lines[0]).toContain('Interrupted');
    expect(result?.lines[0]).toContain('alice');
  });

  it('/agent interrupt accepts @name', async () => {
    globalThis.fetch = mockFetch([
      { ok: true, body: mockAgents },
      { ok: true, body: {} },
    ]) as unknown as typeof fetch;
    const result = await executeCommand('http://localhost', '/agent interrupt @alice');
    expect(result?.error).toBeUndefined();
    expect(result?.lines[0]).toContain('Interrupted');
    expect(result?.lines[0]).toContain('alice');
  });

  it('/agent forget accepts @name', async () => {
    globalThis.fetch = mockFetch([
      { ok: true, body: mockAgents },
      { ok: true, body: {} },
    ]) as unknown as typeof fetch;
    const result = await executeCommand('http://localhost', '/agent forget @bob');
    expect(result?.error).toBeUndefined();
    expect(result?.lines[0]).toContain('Session cleared');
    expect(result?.lines[0]).toContain('bob');
  });

  it('/agent interrupt with unknown name returns error', async () => {
    globalThis.fetch = mockFetch([
      { ok: true, body: mockAgents },
    ]) as unknown as typeof fetch;
    const result = await executeCommand('http://localhost', '/agent interrupt @unknown');
    expect(result?.error).toBe(true);
    expect(result?.lines[0]).toContain('not found');
  });

  it('/agent interrupt without name shows usage', async () => {
    const result = await executeCommand('http://localhost', '/agent interrupt');
    expect(result?.error).toBe(true);
    expect(result?.lines[0]).toContain('Usage');
  });
});
