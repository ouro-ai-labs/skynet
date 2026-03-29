import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentType, MessageType } from '@skynet-ai/protocol';
import type { SkynetMessage, ChatPayload, TaskPayload } from '@skynet-ai/protocol';

// Mock execa before importing the adapter
vi.mock('execa', () => ({
  execa: vi.fn(),
  execaCommand: vi.fn(),
}));

import { execa, execaCommand } from 'execa';
import { OpenCodeAdapter } from '../adapters/opencode.js';

const mockExeca = vi.mocked(execa);
const mockExecaCommand = vi.mocked(execaCommand);

/** Build JSONL output matching OpenCode's `--format json` format. */
function makeJsonlOutput(text: string): string {
  const lines = [
    JSON.stringify({ type: 'step_start', timestamp: Date.now(), sessionID: 'ses_test', part: { type: 'step-start' } }),
    JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID: 'ses_test', part: { type: 'text', text } }),
    JSON.stringify({ type: 'step_finish', timestamp: Date.now(), sessionID: 'ses_test', part: { type: 'step-finish', reason: 'stop' } }),
  ];
  return lines.join('\n');
}

function mockOpenCodeResult(text: string) {
  return {
    stdout: makeJsonlOutput(text),
    stderr: null,
    exitCode: 0,
    kill: vi.fn(),
  } as never;
}

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

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenCodeAdapter({ projectRoot: '/tmp/test' });
  });

  it('has correct type and name', () => {
    expect(adapter.type).toBe(AgentType.OPENCODE);
    expect(adapter.name).toBe('opencode');
  });

  describe('isAvailable', () => {
    it('returns true when opencode is installed', async () => {
      mockExecaCommand.mockResolvedValueOnce({ stdout: '1.0.0' } as never);
      expect(await adapter.isAvailable()).toBe(true);
      expect(mockExecaCommand).toHaveBeenCalledWith('opencode --version');
    });

    it('returns false when opencode is not installed', async () => {
      mockExecaCommand.mockRejectedValueOnce(new Error('not found'));
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe('handleMessage', () => {
    it('sends chat message as prompt to opencode run', async () => {
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Hello back!'));

      const result = await adapter.handleMessage(makeChatMessage('Hello'), 'Alice');
      expect(result).toBe('Hello back!');

      const callArgs = mockExeca.mock.calls[0];
      expect(callArgs[0]).toBe('opencode');
      const args = callArgs[1] as string[];
      expect(args[0]).toBe('run');
      expect(args).toContain('--format');
      expect(args).toContain('json');
      expect(args[args.length - 1]).toContain('Message from Alice: Hello');
    });

    it('prepends notices to the prompt', async () => {
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Got it'));

      await adapter.handleMessage(makeChatMessage('Hi'), 'Bob', 'Notice: Alice joined');

      const args = mockExeca.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('Notice: Alice joined');
      expect(prompt).toContain('Message from Bob: Hi');
    });

    it('prepends persona to prompt when set', async () => {
      adapter.persona = 'You are a helpful assistant.';
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Sure'));

      await adapter.handleMessage(makeChatMessage('Help me'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('You are a helpful assistant.');
      expect(prompt).toContain('Message from Alice: Help me');
    });

    it('uses --session and --continue for subsequent calls', async () => {
      // First call
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('First'));
      await adapter.handleMessage(makeChatMessage('First'), 'Alice');

      const firstArgs = mockExeca.mock.calls[0][1] as string[];
      expect(firstArgs).not.toContain('--continue');

      // Second call
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Second'));
      await adapter.handleMessage(makeChatMessage('Second'), 'Alice');

      const secondArgs = mockExeca.mock.calls[1][1] as string[];
      expect(secondArgs).toContain('--session');
      expect(secondArgs).toContain('--continue');
    });

    it('passes --model flag when model is set', async () => {
      adapter = new OpenCodeAdapter({ projectRoot: '/tmp/test', model: 'anthropic/claude-3-5-sonnet' });
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Done'));

      await adapter.handleMessage(makeChatMessage('Do it'), 'Alice');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('anthropic/claude-3-5-sonnet');
    });
  });

  describe('executeTask', () => {
    it('returns success with summary', async () => {
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Task completed'));

      const result = await adapter.executeTask({
        title: 'Fix bug',
        description: 'Fix the login bug',
      } as TaskPayload);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Task completed');
    });

    it('returns failure on error', async () => {
      mockExeca.mockReturnValueOnce(
        Promise.reject(new Error('Process failed')) as never,
      );

      const result = await adapter.executeTask({
        title: 'Fix bug',
        description: 'Fix the login bug',
      } as TaskPayload);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('parseOutput', () => {
    it('extracts text from JSONL text events', async () => {
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Hello from opencode'));

      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('Hello from opencode');
    });

    it('concatenates multiple text events', async () => {
      const lines = [
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'Hello ' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'world!' } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish' } }),
      ];
      mockExeca.mockReturnValueOnce({
        stdout: lines.join('\n'),
        stderr: null,
        exitCode: 0,
        kill: vi.fn(),
      } as never);

      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('Hello world!');
    });

    it('falls back to raw text for non-JSON output', async () => {
      mockExeca.mockReturnValueOnce({
        stdout: 'Plain text response',
        stderr: null,
        exitCode: 0,
        kill: vi.fn(),
      } as never);

      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('Plain text response');
    });

    it('returns empty string for empty output', async () => {
      mockExeca.mockReturnValueOnce({
        stdout: '',
        stderr: null,
        exitCode: 0,
        kill: vi.fn(),
      } as never);

      const result = await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(result).toBe('');
    });

    it('emits execution log for tool calls', async () => {
      const onLog = vi.fn();
      adapter.onExecutionLog = onLog;

      const lines = [
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'tool_call', part: { type: 'tool-call', name: 'read_file' } }),
        JSON.stringify({ type: 'tool_result', part: { type: 'tool-result' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'Done' } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish' } }),
      ];
      mockExeca.mockReturnValueOnce({
        stdout: lines.join('\n'),
        stderr: null,
        exitCode: 0,
        kill: vi.fn(),
      } as never);

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(onLog).toHaveBeenCalledWith('tool.call', 'read_file');
      expect(onLog).toHaveBeenCalledWith('tool.result', 'completed');
    });
  });

  describe('session management', () => {
    it('getSessionState returns current state', () => {
      const state = adapter.getSessionState();
      expect(state).toBeDefined();
      expect(state!.sessionId).toBeDefined();
      expect(state!.sessionStarted).toBe(false);
    });

    it('restoreSessionState restores state', () => {
      adapter.restoreSessionState({ sessionId: 'test-id', sessionStarted: true });
      const state = adapter.getSessionState();
      expect(state!.sessionId).toBe('test-id');
      expect(state!.sessionStarted).toBe(true);
    });

    it('resetSession generates new session', async () => {
      const originalState = adapter.getSessionState();
      await adapter.resetSession();
      const newState = adapter.getSessionState();
      expect(newState!.sessionId).not.toBe(originalState!.sessionId);
      expect(newState!.sessionStarted).toBe(false);
    });

    it('supportsQuickReply returns false before session starts', () => {
      expect(adapter.supportsQuickReply()).toBe(false);
    });

    it('supportsQuickReply returns true after session starts', async () => {
      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Ok'));
      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(adapter.supportsQuickReply()).toBe(true);
    });
  });

  describe('quickReply', () => {
    it('uses --fork flag', async () => {
      adapter.restoreSessionState({ sessionId: 'sess-1', sessionStarted: true });

      mockExeca.mockReturnValueOnce({
        stdout: 'Quick response',
        exitCode: 0,
      } as never);

      const result = await adapter.quickReply('Quick question');
      expect(result).toBe('Quick response');

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('--fork');
      expect(args).toContain('--session');
      expect(args).toContain('sess-1');
      expect(args).toContain('--format');
      expect(args).toContain('text');
    });
  });

  describe('interrupt', () => {
    it('returns false when nothing is running', async () => {
      expect(await adapter.interrupt()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('does not throw', async () => {
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });
  });

  describe('onPrompt callback', () => {
    it('calls onPrompt with message type', async () => {
      const onPrompt = vi.fn();
      adapter.onPrompt = onPrompt;

      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Ok'));

      await adapter.handleMessage(makeChatMessage('Hi'), 'Alice');
      expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining('Message from Alice: Hi'), { type: 'message' });
    });

    it('calls onPrompt with task type', async () => {
      const onPrompt = vi.fn();
      adapter.onPrompt = onPrompt;

      mockExeca.mockReturnValueOnce(mockOpenCodeResult('Done'));

      await adapter.executeTask({ title: 'Fix', description: 'Fix it' } as TaskPayload);
      expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining('Task: Fix'), { type: 'task' });
    });
  });
});
