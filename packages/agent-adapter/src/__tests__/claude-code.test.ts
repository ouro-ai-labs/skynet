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

  it('marks session as started even if first call fails (avoids session ID conflict)', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // First call fails (e.g. timeout)
    (execa as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Command timed out'));

    await expect(adapter.handleMessage(makeMsg())).rejects.toThrow('Command timed out');

    // Second call should use --resume (not --session-id) to avoid "Session ID already in use"
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
    await adapter.handleMessage(makeMsg({ text: 'retry' }));

    const secondArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('--resume');
    expect(secondArgs).not.toContain('--session-id');
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
});

describe('ClaudeCodeAdapter nested-session guard', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('unsets CLAUDECODE env var when spawning claude', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    process.env.CLAUDECODE = '1';
    try {
      await adapter.handleMessage(makeMsg());

      const opts = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2] as { env: Record<string, string | undefined> };
      expect(opts.env).toBeDefined();
      expect(opts.env.CLAUDECODE).toBeUndefined();
    } finally {
      delete process.env.CLAUDECODE;
    }
  });

  it('quickReply also unsets CLAUDECODE env var', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg());
    vi.clearAllMocks();

    process.env.CLAUDECODE = '1';
    try {
      await adapter.quickReply('test');

      const opts = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2] as { env: Record<string, string | undefined> };
      expect(opts.env).toBeDefined();
      expect(opts.env.CLAUDECODE).toBeUndefined();
    } finally {
      delete process.env.CLAUDECODE;
    }
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
      expect.objectContaining({ cwd: tempDir, stdin: 'ignore', timeout: 1_200_000 }),
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

describe('ClaudeCodeAdapter error sanitization', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('strips full command line from execa errors to avoid leaking system prompt', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    adapter.persona = 'You are a secret agent with classified instructions.';

    // Simulate an execa error with shortMessage (clean) and message (leaks command)
    const execaError = new Error(
      'Command failed with exit code 1: claude -p "hello" --append-system-prompt "You are a secret agent with classified instructions."',
    );
    (execaError as unknown as { shortMessage: string }).shortMessage = 'Command failed with exit code 1';
    (execa as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(execaError);

    const err = await adapter.handleMessage(makeMsg()).catch((e: unknown) => e) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Command failed with exit code 1');
    expect(err.message).not.toContain('secret agent');
    expect(err.message).not.toContain('append-system-prompt');
  });

  it('preserves error message when no shortMessage is available', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    (execa as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Connection refused'));

    const err = await adapter.handleMessage(makeMsg()).catch((e: unknown) => e) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Connection refused');
  });

  it('sanitizes quickReply errors too', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // Start session first
    await adapter.handleMessage(makeMsg());

    const execaError = new Error('Command timed out: claude -p "test" --resume abc --fork-session');
    (execaError as unknown as { shortMessage: string }).shortMessage = 'Command timed out';
    (execa as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(execaError);

    const err = await adapter.quickReply('test').catch((e: unknown) => e) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Command timed out');
    expect(err.message).not.toContain('--resume');
  });
});

describe('ClaudeCodeAdapter quickReply (session fork)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('supportsQuickReply returns false before session is started', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    expect(adapter.supportsQuickReply()).toBe(false);
  });

  it('supportsQuickReply returns true after session is started', async () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    await adapter.handleMessage(makeMsg());
    expect(adapter.supportsQuickReply()).toBe(true);
  });

  it('quickReply uses --resume and --fork-session with correct session ID', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // Start session first
    await adapter.handleMessage(makeMsg());
    const firstArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    const sessionId = firstArgs[firstArgs.indexOf('--session-id') + 1];

    vi.clearAllMocks();

    await adapter.quickReply('How is progress?');

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '-p', 'How is progress?',
        '--output-format', 'text',
        '--resume', sessionId,
        '--fork-session',
      ]),
      expect.objectContaining({ cwd: tempDir, stdin: 'ignore', timeout: 60_000 }),
    );
  });

  it('quickReply includes --model when configured', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, model: 'haiku' });

    await adapter.handleMessage(makeMsg());
    vi.clearAllMocks();

    await adapter.quickReply('status?');

    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('haiku');
  });

  it('quickReply returns stdout from forked session', async () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    await adapter.handleMessage(makeMsg());

    const result = await adapter.quickReply('what are you doing?');
    expect(result).toBe('mock response');
  });
});
