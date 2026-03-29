import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { AgentType, MessageType } from '@skynet-ai/protocol';
import type { SkynetMessage, ChatPayload, TaskPayload } from '@skynet-ai/protocol';

/**
 * Create a mock process emitting Codex JSONL events on stdout.
 * Mimics an execa ResultPromise: readable stdout, thenable, killable.
 */
function createMockProcess(
  agentMessages: string[],
  threadId = 'thread-test-123',
  commandEvents: Array<{ command: string; exitCode: number }> = [],
) {
  const lines: string[] = [
    JSON.stringify({ type: 'thread.started', thread_id: threadId }),
    JSON.stringify({ type: 'turn.started' }),
  ];
  for (const cmd of commandEvents) {
    lines.push(JSON.stringify({
      type: 'item.started',
      item: { id: 'cmd-1', type: 'command_execution', command: cmd.command, status: 'in_progress' },
    }));
    lines.push(JSON.stringify({
      type: 'item.completed',
      item: { id: 'cmd-1', type: 'command_execution', command: cmd.command, aggregated_output: '', exit_code: cmd.exitCode, status: 'completed' },
    }));
  }
  for (const text of agentMessages) {
    lines.push(JSON.stringify({
      type: 'item.completed',
      item: { id: `msg-${Math.random()}`, type: 'agent_message', text },
    }));
  }
  lines.push(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }));

  const stdout = Readable.from(lines.map((l) => l + '\n'));
  const proc = {
    stdout,
    stderr: Readable.from([]),
    exitCode: 0 as number | null,
    kill: vi.fn(),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve({ stdout: '', stderr: '' }).then(resolve, reject);
    },
  };
  return proc;
}

function createFailingMockProcess(error: Error) {
  const stdout = Readable.from([]);
  const proc = {
    stdout,
    stderr: Readable.from([]),
    exitCode: 1 as number | null,
    kill: vi.fn(),
    then: (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.reject(error).then(_resolve, reject);
    },
  };
  return proc;
}

vi.mock('execa', () => ({
  execa: vi.fn(() => createMockProcess(['mock response'])),
  execaCommand: vi.fn().mockResolvedValue({ stdout: 'codex 1.0.0', stderr: '' }),
}));

import { execa, execaCommand } from 'execa';
import { CodexCliAdapter } from '../../adapters/codex-cli.js';

const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;
const mockExecaCommand = vi.mocked(execaCommand);

function makeChatMessage(text: string, from = 'user-1'): SkynetMessage {
  return {
    id: 'msg-1',
    type: MessageType.CHAT,
    from,
    to: 'agent-1',
    payload: { text } as ChatPayload,
    timestamp: Date.now(),
  };
}

describe('CodexCliAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has type CODEX_CLI and name codex-cli', () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project' });
    expect(adapter.type).toBe(AgentType.CODEX_CLI);
    expect(adapter.name).toBe('codex-cli');
  });

  describe('isAvailable', () => {
    it('returns true when codex is installed', async () => {
      mockExecaCommand.mockResolvedValueOnce({ stdout: '1.0.0' } as never);
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      expect(await adapter.isAvailable()).toBe(true);
      expect(mockExecaCommand).toHaveBeenCalledWith('codex --version');
    });

    it('returns false when codex is not installed', async () => {
      mockExecaCommand.mockRejectedValueOnce(new Error('not found'));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe('handleMessage', () => {
    it('sends chat message as prompt via codex exec', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Hello back!']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const result = await adapter.handleMessage(makeChatMessage('Hello'), 'Alice');
      expect(result).toBe('Hello back!');

      expect(mockExeca).toHaveBeenCalledWith(
        'codex',
        expect.arrayContaining(['exec', '--json']),
        expect.objectContaining({ cwd: '/project', stdin: 'ignore', timeout: 0 }),
      );
      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toContain('Message from Alice: Hello');
    });

    it('prepends notices to the prompt', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Got it']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      await adapter.handleMessage(makeChatMessage('Hi'), 'Bob', 'Notice: Alice joined');

      const args = mockExeca.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('Notice: Alice joined');
      expect(prompt).toContain('Message from Bob: Hi');
    });

    it('prepends persona to prompt when set', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Sure']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.persona = 'You are a helpful assistant.';

      await adapter.handleMessage(makeChatMessage('Help me'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('You are a helpful assistant.');
      expect(prompt).toContain('Message from Alice: Help me');
    });

    it('uses --dangerously-bypass-approvals-and-sandbox by default', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Ok']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(args).not.toContain('--full-auto');
    });

    it('uses --full-auto when fullAuto option is set', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Ok']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project', fullAuto: true });

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('--full-auto');
      expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('passes -C projectRoot on first call', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Ok']));
      const adapter = new CodexCliAdapter({ projectRoot: '/my/project' });

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('-C');
      expect(args).toContain('/my/project');
    });

    it('passes -m model when model is set', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Done']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project', model: 'o3' });

      await adapter.handleMessage(makeChatMessage('Do it'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('-m');
      expect(args).toContain('o3');
    });

    it('concatenates multiple agent messages', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Hello ', 'world!']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('Hello \nworld!');
    });
  });

  describe('session management', () => {
    it('uses exec resume with thread ID for subsequent calls', async () => {
      // First call
      mockExeca.mockReturnValueOnce(createMockProcess(['First'], 'thread-abc'));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      await adapter.handleMessage(makeChatMessage('First'), 'Alice');

      const firstArgs = mockExeca.mock.calls[0][1] as string[];
      expect(firstArgs[0]).toBe('exec');
      expect(firstArgs).not.toContain('resume');

      // Second call should use exec resume with thread ID
      mockExeca.mockReturnValueOnce(createMockProcess(['Second'], 'thread-abc'));
      await adapter.handleMessage(makeChatMessage('Second'), 'Alice');

      const secondArgs = mockExeca.mock.calls[1][1] as string[];
      expect(secondArgs[0]).toBe('exec');
      expect(secondArgs[1]).toBe('resume');
      expect(secondArgs[2]).toBe('thread-abc');
    });

    it('getSessionState returns thread ID and started flag', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const stateBefore = adapter.getSessionState();
      expect(stateBefore.sessionStarted).toBe(false);

      mockExeca.mockReturnValueOnce(createMockProcess(['Ok'], 'thread-xyz'));
      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      const stateAfter = adapter.getSessionState();
      expect(stateAfter.sessionId).toBe('thread-xyz');
      expect(stateAfter.sessionStarted).toBe(true);
    });

    it('restoreSessionState sets thread ID and started flag', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.restoreSessionState({ sessionId: 'thread-restored', sessionStarted: true });

      mockExeca.mockReturnValueOnce(createMockProcess(['Resumed']));
      await adapter.handleMessage(makeChatMessage('Continue'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('resume');
      expect(args).toContain('thread-restored');
    });

    it('resetSession generates new session and clears thread ID', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      mockExeca.mockReturnValueOnce(createMockProcess(['Ok'], 'thread-old'));
      await adapter.handleMessage(makeChatMessage('First'), 'Alice');

      await adapter.resetSession();

      const state = adapter.getSessionState();
      expect(state.sessionStarted).toBe(false);

      // Next call should start a new session (no resume)
      mockExeca.mockReturnValueOnce(createMockProcess(['Fresh'], 'thread-new'));
      await adapter.handleMessage(makeChatMessage('After reset'), 'Alice');

      const args = mockExeca.mock.calls[1][1] as string[];
      expect(args).not.toContain('resume');
    });

    it('marks session as started even if first call fails', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      mockExeca.mockReturnValueOnce(createFailingMockProcess(new Error('Process failed')));

      await expect(adapter.handleMessage(makeChatMessage('Fail'), 'Alice')).rejects.toThrow();

      // Session should be marked as started to avoid ID conflicts
      const state = adapter.getSessionState();
      expect(state.sessionStarted).toBe(true);
    });
  });

  describe('executeTask', () => {
    it('returns success with summary', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Task completed']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const result = await adapter.executeTask({
        title: 'Fix bug',
        description: 'Fix the login bug',
      } as TaskPayload);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Task completed');
    });

    it('includes relevant files in prompt', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Done']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      await adapter.executeTask({
        title: 'Fix',
        description: 'Fix it',
        files: ['src/a.ts', 'src/b.ts'],
      } as TaskPayload);

      const args = mockExeca.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('Relevant files: src/a.ts, src/b.ts');
    });

    it('returns failure on error', async () => {
      mockExeca.mockReturnValueOnce(createFailingMockProcess(new Error('Process failed')));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const result = await adapter.executeTask({
        title: 'Fix bug',
        description: 'Fix the login bug',
      } as TaskPayload);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('JSONL parsing', () => {
    it('extracts text from agent_message events', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Hello from codex']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('Hello from codex');
    });

    it('emits tool.call for command_execution started events', async () => {
      const onLog = vi.fn();
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.onExecutionLog = onLog;

      mockExeca.mockReturnValueOnce(createMockProcess(
        ['Done'],
        'thread-1',
        [{ command: 'cat src/index.ts', exitCode: 0 }],
      ));

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      expect(onLog).toHaveBeenCalledWith('tool.call', 'cat src/index.ts');
    });

    it('emits tool.result for command_execution completed events', async () => {
      const onLog = vi.fn();
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.onExecutionLog = onLog;

      mockExeca.mockReturnValueOnce(createMockProcess(
        ['Done'],
        'thread-1',
        [{ command: 'npm test', exitCode: 0 }],
      ));

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      expect(onLog).toHaveBeenCalledWith('tool.result', 'npm test (exit 0)');
    });

    it('truncates long command summaries', async () => {
      const onLog = vi.fn();
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.onExecutionLog = onLog;

      const longCommand = 'x'.repeat(100);
      mockExeca.mockReturnValueOnce(createMockProcess(
        ['Done'],
        'thread-1',
        [{ command: longCommand, exitCode: 0 }],
      ));

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      // tool.call should be truncated to 80 chars + ellipsis
      const callArgs = onLog.mock.calls.find(c => c[0] === 'tool.call');
      expect(callArgs).toBeDefined();
      expect(callArgs![1].length).toBeLessThanOrEqual(82); // 80 + '…'
    });

    it('does not emit logs when onExecutionLog is not set', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      // No onExecutionLog set

      mockExeca.mockReturnValueOnce(createMockProcess(
        ['Done'],
        'thread-1',
        [{ command: 'echo test', exitCode: 0 }],
      ));

      // Should not throw even without callback
      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('Done');
    });

    it('handles non-JSON lines gracefully', async () => {
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
        'Shell cwd was reset to /Users/test',
        JSON.stringify({ type: 'turn.completed', usage: {} }),
      ];
      const stdout = Readable.from(lines.map(l => l + '\n'));
      const proc = {
        stdout,
        stderr: Readable.from([]),
        exitCode: 0,
        kill: vi.fn(),
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve({ stdout: '', stderr: '' }).then(resolve, reject),
      };
      mockExeca.mockReturnValueOnce(proc);

      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      // Non-JSON line should be accumulated as raw text
      expect(result).toContain('Shell cwd was reset');
    });
  });

  describe('error sanitization', () => {
    it('strips full command line from execa errors', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.persona = 'You are a secret agent.';

      const execaError = new Error(
        'Command failed: codex exec --json --dangerously-bypass-approvals-and-sandbox "You are a secret agent..."',
      );
      (execaError as unknown as { shortMessage: string }).shortMessage = 'Command failed with exit code 1';
      mockExeca.mockReturnValueOnce(createFailingMockProcess(execaError));

      const err = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice').catch((e: unknown) => e) as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Command failed with exit code 1');
      expect(err.message).not.toContain('secret agent');
    });

    it('preserves error message when no shortMessage is available', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      mockExeca.mockReturnValueOnce(createFailingMockProcess(new Error('Connection refused')));

      const err = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice').catch((e: unknown) => e) as Error;
      expect(err.message).toBe('Connection refused');
    });
  });

  describe('interrupt', () => {
    it('returns false when nothing is running', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      expect(await adapter.interrupt()).toBe(false);
    });

    it('returns false after completion (process cleared)', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['Ok']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(await adapter.interrupt()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('resolves without error', async () => {
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });
  });

  describe('onPrompt callback', () => {
    it('calls onPrompt with message type', async () => {
      const onPrompt = vi.fn();
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.onPrompt = onPrompt;

      mockExeca.mockReturnValueOnce(createMockProcess(['Ok']));
      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');

      expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining('Message from Alice: Hi'), { type: 'message' });
    });

    it('calls onPrompt with task type', async () => {
      const onPrompt = vi.fn();
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });
      adapter.onPrompt = onPrompt;

      mockExeca.mockReturnValueOnce(createMockProcess(['Done']));
      await adapter.executeTask({ title: 'Fix', description: 'Fix it' } as TaskPayload);

      expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining('Task: Fix'), { type: 'task' });
    });
  });

  describe('message type handling', () => {
    it('formats TASK_ASSIGN messages', async () => {
      mockExeca.mockReturnValueOnce(createMockProcess(['On it']));
      const adapter = new CodexCliAdapter({ projectRoot: '/project' });

      const msg: SkynetMessage = {
        id: 'msg-1',
        type: MessageType.TASK_ASSIGN,
        from: 'user-1',
        timestamp: Date.now(),
        payload: { title: 'Build feature', description: 'Add login page' } as TaskPayload,
      };
      await adapter.handleMessage(msg, 'Manager');

      const args = mockExeca.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('Task assigned: Build feature');
      expect(prompt).toContain('Add login page');
    });
  });
});
