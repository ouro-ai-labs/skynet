import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentType, MessageType } from '@skynet-ai/protocol';
import type { TaskPayload } from '@skynet-ai/protocol';
import { GenericAdapter } from '../../adapters/generic.js';

vi.mock('execa', () => ({
  execaCommand: vi.fn().mockResolvedValue({ stdout: 'generic output', stderr: '' }),
}));

function makeMsg(overrides: Partial<{ text: string; from: string; type: MessageType }> = {}) {
  return {
    id: 'msg-1',
    type: overrides.type ?? MessageType.CHAT,
    from: overrides.from ?? 'human-1',
    timestamp: Date.now(),
    payload: overrides.type === MessageType.TASK_ASSIGN
      ? { taskId: 't1', title: 'Do stuff', description: 'Details', status: 'assigned' as const }
      : { text: overrides.text ?? 'hello' },
  };
}

describe('GenericAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has type GENERIC and the configured name', () => {
    const adapter = new GenericAdapter({
      name: 'my-tool',
      command: 'my-tool',
      projectRoot: '/project',
    });
    expect(adapter.type).toBe(AgentType.GENERIC);
    expect(adapter.name).toBe('my-tool');
  });

  // ── isAvailable ──

  describe('isAvailable', () => {
    it('returns true when no versionCommand is configured', async () => {
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        projectRoot: '/project',
      });
      expect(await adapter.isAvailable()).toBe(true);
    });

    it('returns true when versionCommand succeeds', async () => {
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        versionCommand: 'tool --version',
        projectRoot: '/project',
      });
      expect(await adapter.isAvailable()).toBe(true);
    });

    it('returns false when versionCommand fails', async () => {
      const { execaCommand } = await import('execa');
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('not found'),
      );
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        versionCommand: 'tool --version',
        projectRoot: '/project',
      });
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  // ── Prompt construction ──

  describe('handleMessage prompt construction', () => {
    it('uses promptFlag mode when configured', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'my-cli',
        args: ['--verbose'],
        promptFlag: '--prompt',
        projectRoot: '/project',
      });

      await adapter.handleMessage(makeMsg({ text: 'test input' }));

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('my-cli');
      expect(cmd).toContain('--verbose');
      expect(cmd).toContain('--prompt');
      expect(cmd).toContain('test input');
    });

    it('uses pipe mode when no promptFlag is configured', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'my-cli',
        projectRoot: '/project',
      });

      await adapter.handleMessage(makeMsg({ text: 'piped' }));

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('echo');
      expect(cmd).toContain('| my-cli');
    });

    it('extracts text from CHAT messages', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      await adapter.handleMessage(makeMsg({ text: 'hello world' }));

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('hello world');
    });

    it('extracts title and description from TASK_ASSIGN messages', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      await adapter.handleMessage(makeMsg({ type: MessageType.TASK_ASSIGN }));

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('Do stuff');
      expect(cmd).toContain('Details');
    });

    it('JSON-stringifies payload for unknown message types', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      const msg = {
        id: 'msg-1',
        type: MessageType.CONTEXT_SHARE,
        from: 'agent-1',
        timestamp: Date.now(),
        payload: { files: [{ path: 'a.ts' }] },
      };

      await adapter.handleMessage(msg);

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('a.ts');
    });

    it('prepends persona to prompt when set', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });
      adapter.persona = 'You are a senior developer.';

      await adapter.handleMessage(makeMsg({ text: 'review code' }));

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('senior developer');
      expect(cmd).toContain('review code');
    });

    it('prepends notices when provided', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      await adapter.handleMessage(makeMsg({ text: 'hi' }), 'Alice', '--- Bob joined ---');

      const cmd = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(cmd).toContain('Bob joined');
    });
  });

  // ── Command building ──

  describe('command building', () => {
    it('passes shell and timeout options to execaCommand', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        projectRoot: '/project',
        shell: false,
        timeout: 5000,
        promptFlag: '-p',
      });

      await adapter.handleMessage(makeMsg());

      const opts = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(opts).toEqual(expect.objectContaining({
        cwd: '/project',
        shell: false,
        timeout: 5000,
      }));
    });

    it('defaults shell to true and timeout to 0', async () => {
      const { execaCommand } = await import('execa');
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        projectRoot: '/project',
        promptFlag: '-p',
      });

      await adapter.handleMessage(makeMsg());

      const opts = (execaCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(opts.shell).toBe(true);
      expect(opts.timeout).toBe(0);
    });
  });

  // ── executeTask ──

  describe('executeTask', () => {
    it('returns success with stdout on success', async () => {
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      const result = await adapter.executeTask({
        taskId: 't1',
        title: 'Build feature',
        description: 'Add new button',
        status: 'assigned',
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('generic output');
    });

    it('returns failure with error message on error', async () => {
      const { execaCommand } = await import('execa');
      (execaCommand as unknown as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('process exited with code 1'));

      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      const result = await adapter.executeTask({
        taskId: 't1',
        title: 'Fail task',
        description: 'This will fail',
        status: 'assigned',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('process exited with code 1');
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('sanitizes execa errors with shortMessage', async () => {
      const { execaCommand } = await import('execa');
      const err = new Error('Command failed: tool -p "secret prompt data"');
      (err as unknown as { shortMessage: string }).shortMessage = 'Command failed with exit code 1';
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      const caught = await adapter.handleMessage(makeMsg()).catch((e: unknown) => e) as Error;
      expect(caught.message).toBe('Command failed with exit code 1');
      expect(caught.message).not.toContain('secret prompt');
    });

    it('preserves error when shortMessage matches message', async () => {
      const { execaCommand } = await import('execa');
      const err = new Error('timeout');
      (err as unknown as { shortMessage: string }).shortMessage = 'timeout';
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      const caught = await adapter.handleMessage(makeMsg()).catch((e: unknown) => e) as Error;
      expect(caught.message).toBe('timeout');
    });

    it('wraps non-Error throwables', async () => {
      const { execaCommand } = await import('execa');
      (execaCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });

      const caught = await adapter.handleMessage(makeMsg()).catch((e: unknown) => e) as Error;
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toBe('string error');
    });
  });

  // ── onPrompt callback ──

  describe('onPrompt callback', () => {
    it('calls onPrompt with message type context for handleMessage', async () => {
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });
      const spy = vi.fn();
      adapter.onPrompt = spy;

      await adapter.handleMessage(makeMsg({ text: 'hello' }));

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('hello'),
        { type: 'message' },
      );
    });

    it('calls onPrompt with task type context for executeTask', async () => {
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        promptFlag: '-p',
        projectRoot: '/project',
      });
      const spy = vi.fn();
      adapter.onPrompt = spy;

      await adapter.executeTask({
        taskId: 't1',
        title: 'My Task',
        description: 'Do it',
        status: 'assigned',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('My Task'),
        { type: 'task' },
      );
    });
  });

  // ── dispose ──

  describe('dispose', () => {
    it('resolves without error', async () => {
      const adapter = new GenericAdapter({
        name: 'tool',
        command: 'tool',
        projectRoot: '/project',
      });
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });
  });
});
