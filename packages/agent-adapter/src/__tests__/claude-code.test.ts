import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageType } from '@skynet/protocol';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: 'mock response', stderr: '' }),
  execaCommand: vi.fn().mockResolvedValue({ stdout: 'claude 1.0.0', stderr: '' }),
}));

function makeMsg(overrides: Partial<{ text: string; from: string }> = {}) {
  return {
    id: 'msg-1',
    type: MessageType.CHAT as const,
    from: overrides.from ?? 'human-123',
    to: null,
    roomId: 'room-1',
    timestamp: Date.now(),
    payload: { text: overrides.text ?? 'hello' },
  };
}

describe('ClaudeCodeAdapter session continuity', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('first call uses --session-id to create a new session', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg());

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--session-id']),
      expect.any(Object),
    );
    // Should NOT have --resume on first call
    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).not.toContain('--resume');
  });

  it('subsequent calls use --resume with same session ID', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg({ text: 'first' }));
    const firstArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    const sessionIdIdx = firstArgs.indexOf('--session-id');
    const sessionId = firstArgs[sessionIdIdx + 1];

    await adapter.handleMessage(makeMsg({ text: 'second' }));
    const secondArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('--resume');
    expect(secondArgs).toContain(sessionId);
    expect(secondArgs).not.toContain('--session-id');
  });

  it('setRoomId resets session so next call uses --session-id again', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg({ text: 'first' }));
    const firstArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    const firstSessionId = firstArgs[firstArgs.indexOf('--session-id') + 1];

    adapter.setRoomId('new-room');

    await adapter.handleMessage(makeMsg({ text: 'after room change' }));
    const secondArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('--session-id');
    expect(secondArgs).not.toContain('--resume');
    // New session ID should differ
    const newSessionId = secondArgs[secondArgs.indexOf('--session-id') + 1];
    expect(newSessionId).not.toBe(firstSessionId);
  });
});

describe('ClaudeCodeAdapter handleMessage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('calls execa with correct args and returns stdout', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const result = await adapter.handleMessage(makeMsg({ text: 'hello "world" $HOME' }));

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', 'Message from human-123: hello "world" $HOME', '--output-format', 'text']),
      expect.objectContaining({ cwd: tempDir, stdin: 'ignore', timeout: 300_000 }),
    );
    expect(result).toBe('mock response');
  });

  it('uses senderName instead of agentId in prompt when provided', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg({ text: '你是谁', from: 'uuid-123' }), 'Alice');

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', 'Message from Alice: 你是谁']),
      expect.any(Object),
    );
  });

  it('falls back to agentId when senderName is not provided', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg({ from: 'agent-xyz' }));

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', 'Message from agent-xyz: hello']),
      expect.any(Object),
    );
  });

  it('includes --model and --allowedTools when configured', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({
      projectRoot: tempDir,
      model: 'opus',
      allowedTools: ['Read', 'Write'],
    });

    await adapter.handleMessage(makeMsg());

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--model', 'opus', '--allowedTools', 'Read,Write']),
      expect.any(Object),
    );
  });
});
