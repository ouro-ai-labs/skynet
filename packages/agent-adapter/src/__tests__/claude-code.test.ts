import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MessageType } from '@skynet-ai/protocol';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';

/**
 * Create a mock process object that mimics an execa ResultPromise:
 * - has a readable `stdout` stream emitting JSONL lines
 * - is thenable (awaiting it resolves after stdout is consumed)
 */
function createMockProcess(resultText = 'mock response', events: Array<Record<string, unknown>> = []) {
  const lines = [
    ...events.map((e) => JSON.stringify(e)),
    JSON.stringify({ type: 'result', subtype: 'success', result: resultText }),
  ];

  const stdout = Readable.from(lines.map((l) => l + '\n'));
  const proc = {
    stdout,
    stderr: Readable.from([]),
    kill: vi.fn(),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve({ stdout: '', stderr: '' }).then(resolve, reject);
    },
  };
  return proc;
}

/** Create a mock process that rejects (simulating execa error). */
function createFailingMockProcess(error: Error) {
  const stdout = Readable.from([]);
  const proc = {
    stdout,
    stderr: Readable.from([]),
    kill: vi.fn(),
    then: (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.reject(error).then(_resolve, reject);
    },
  };
  return proc;
}

vi.mock('execa', () => ({
  execa: vi.fn(() => createMockProcess()),
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
    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(createFailingMockProcess(new Error('Command timed out')));

    await expect(adapter.handleMessage(makeMsg())).rejects.toThrow('Command timed out');

    // Second call should use --resume (not --session-id) to avoid "Session ID already in use"
    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(createMockProcess('ok'));
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
      expect.arrayContaining(['-p', 'Message from human-123: hello "world" $HOME', '--output-format', 'stream-json']),
      expect.objectContaining({ cwd: tempDir, stdin: 'ignore', timeout: 0 }),
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
    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(createFailingMockProcess(execaError));

    const err = await adapter.handleMessage(makeMsg()).catch((e: unknown) => e) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Command failed with exit code 1');
    expect(err.message).not.toContain('secret agent');
    expect(err.message).not.toContain('append-system-prompt');
  });

  it('preserves error message when no shortMessage is available', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(createFailingMockProcess(new Error('Connection refused')));

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
      expect.objectContaining({ cwd: tempDir, stdin: 'ignore' }),
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
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    await adapter.handleMessage(makeMsg());

    // quickReply uses --output-format text (not stream-json), so it awaits the process
    // directly and reads result.stdout — provide a standard mock for it.
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stdout: 'quick reply result', stderr: '' });

    const result = await adapter.quickReply('what are you doing?');
    expect(result).toBe('quick reply result');
  });
});

describe('ClaudeCodeAdapter interrupt', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when no process is running', async () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    const result = await adapter.interrupt();
    expect(result).toBe(false);
  });

  it('tracks the running process and clears it after completion', async () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // After handleMessage completes, runningProcess should be null
    await adapter.handleMessage(makeMsg());

    // No running process → interrupt returns false
    const result = await adapter.interrupt();
    expect(result).toBe(false);
  });
});

describe('ClaudeCodeAdapter session state persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('getSessionState returns current session ID and started flag', async () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const stateBefore = adapter.getSessionState();
    expect(stateBefore.sessionId).toBeTruthy();
    expect(stateBefore.sessionStarted).toBe(false);

    await adapter.handleMessage(makeMsg());
    const stateAfter = adapter.getSessionState();
    expect(stateAfter.sessionId).toBe(stateBefore.sessionId);
    expect(stateAfter.sessionStarted).toBe(true);
  });

  it('restoreSessionState sets session ID and started flag', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    adapter.restoreSessionState({
      sessionId: 'restored-session-id-123',
      sessionStarted: true,
    });

    await adapter.handleMessage(makeMsg());
    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args).toContain('restored-session-id-123');
    expect(args).not.toContain('--session-id');
  });

  it('restoreSessionState with sessionStarted=false uses --session-id', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    adapter.restoreSessionState({
      sessionId: 'restored-session-id-456',
      sessionStarted: false,
    });

    await adapter.handleMessage(makeMsg());
    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('--session-id');
    expect(args).toContain('restored-session-id-456');
    expect(args).not.toContain('--resume');
  });

  it('supportsQuickReply reflects restored sessionStarted state', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    expect(adapter.supportsQuickReply()).toBe(false);

    adapter.restoreSessionState({
      sessionId: 'some-id',
      sessionStarted: true,
    });
    expect(adapter.supportsQuickReply()).toBe(true);
  });
});

describe('ClaudeCodeAdapter image attachments', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeMsgWithImage(text = 'check this image') {
    return {
      id: 'msg-img-1',
      type: MessageType.CHAT as const,
      from: 'human-123',
      timestamp: Date.now(),
      payload: {
        text,
        attachments: [{
          type: 'image' as const,
          mimeType: 'image/png',
          name: 'screenshot.png',
          data: 'iVBORw0KGgo=', // minimal base64
          size: 10,
        }],
      },
    };
  }

  it('embeds image file paths in prompt instead of using --image flag', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsgWithImage());

    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    // Must NOT use the non-existent --image flag
    expect(args).not.toContain('--image');
    // The prompt should contain image file path reference
    const promptIdx = args.indexOf('-p');
    const prompt = args[promptIdx + 1];
    expect(prompt).toContain('Image: ');
    expect(prompt).toContain('skynet-img-');
    expect(prompt).toContain('Please read the image file');
  });

  it('includes original message text along with image reference', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsgWithImage('describe this'));

    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    const prompt = args[args.indexOf('-p') + 1];
    expect(prompt).toContain('Message from human-123: describe this');
    expect(prompt).toContain('Image: ');
  });

  it('does not modify prompt when message has no attachments', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg({ text: 'no images here' }));

    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    const prompt = args[args.indexOf('-p') + 1];
    expect(prompt).toBe('Message from human-123: no images here');
    expect(prompt).not.toContain('Image: ');
  });
});

describe('ClaudeCodeAdapter resetSession', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a new session ID after reset', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // Start a session
    await adapter.handleMessage(makeMsg());
    const firstArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    const firstSessionId = firstArgs[firstArgs.indexOf('--session-id') + 1];

    // Reset
    await adapter.resetSession();

    // Next call should use --session-id (not --resume) with a NEW session ID
    await adapter.handleMessage(makeMsg({ text: 'after reset' }));
    const secondArgs = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('--session-id');
    expect(secondArgs).not.toContain('--resume');

    const secondSessionId = secondArgs[secondArgs.indexOf('--session-id') + 1];
    expect(secondSessionId).not.toBe(firstSessionId);
  });

  it('supportsQuickReply returns false after reset', async () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // Start session
    await adapter.handleMessage(makeMsg());
    expect(adapter.supportsQuickReply()).toBe(true);

    // Reset
    await adapter.resetSession();
    expect(adapter.supportsQuickReply()).toBe(false);
  });
});

describe('ClaudeCodeAdapter stream-json parsing', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses result text from stream-json output', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      createMockProcess('final answer here'),
    );

    const result = await adapter.handleMessage(makeMsg());
    expect(result).toBe('final answer here');
  });

  it('emits tool.call events via onExecutionLog callback', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const logCalls: Array<{ event: string; summary: string; metadata?: Record<string, unknown> }> = [];
    adapter.onExecutionLog = (event, summary, metadata) => {
      logCalls.push({ event, summary, metadata });
    };

    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      createMockProcess('done', [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: '/foo.ts' } },
            ],
          },
        },
      ]),
    );

    await adapter.handleMessage(makeMsg());

    expect(logCalls).toHaveLength(1);
    expect(logCalls[0].event).toBe('tool.call');
    expect(logCalls[0].summary).toBe('Read /foo.ts');
    expect(logCalls[0].metadata).toEqual({ input: { file_path: '/foo.ts' } });
  });

  it('emits tool.result events via onExecutionLog callback', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const logCalls: Array<{ event: string; summary: string }> = [];
    adapter.onExecutionLog = (event, summary) => {
      logCalls.push({ event, summary });
    };

    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      createMockProcess('done', [
        { type: 'tool_result', content: 'file contents here' },
      ]),
    );

    await adapter.handleMessage(makeMsg());

    expect(logCalls).toHaveLength(1);
    expect(logCalls[0].event).toBe('tool.result');
    expect(logCalls[0].summary).toBe('file contents here');
  });

  it('does not emit logs when onExecutionLog is not set', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    // No onExecutionLog set

    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      createMockProcess('done', [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', id: 'tool-1', input: {} }],
          },
        },
      ]),
    );

    // Should not throw even without callback
    const result = await adapter.handleMessage(makeMsg());
    expect(result).toBe('done');
  });

  it('uses stream-json output format for runClaude', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    await adapter.handleMessage(makeMsg());

    const args = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).not.toContain('text');
  });

  it('does not hang when child process keeps stdout open after result (e.g. Vite dev server)', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    // Simulate a stdout stream that emits the result but never ends (child process holds fd open)
    const stdout = new Readable({ read() {} });
    const resultLine = JSON.stringify({ type: 'result', subtype: 'success', result: 'built the UI' });
    // Push result then keep the stream open (no null push)
    stdout.push(resultLine + '\n');

    const proc = {
      stdout,
      stderr: Readable.from([]),
      exitCode: null as number | null,
      kill: vi.fn(() => { proc.exitCode = 143; }),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        // Simulate a process that never exits on its own — resolves only when killed
        return new Promise<unknown>((res) => {
          const check = setInterval(() => {
            if (proc.exitCode !== null) {
              clearInterval(check);
              res({ stdout: '', stderr: '' });
            }
          }, 50);
        }).then(resolve, reject);
      },
    };

    (execa as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(proc);

    // This should resolve quickly, not hang forever
    const result = await adapter.handleMessage(makeMsg());
    expect(result).toBe('built the UI');
  }, 10_000);
});
