import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MessageType } from '@skynet/protocol';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: 'mock response', stderr: '' }),
  execaCommand: vi.fn().mockResolvedValue({ stdout: 'claude 1.0.0', stderr: '' }),
}));

describe('ClaudeCodeAdapter session persistence', () => {
  let tempDir: string;
  let sessionStorePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skynet-test-'));
    sessionStorePath = join(tempDir, '.skynet', 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loadSessionId returns null when no room is set', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    // Access private method via prototype for testing
    const loadSessionId = (adapter as unknown as { loadSessionId(): string | null }).loadSessionId.bind(adapter);
    expect(loadSessionId()).toBeNull();
  });

  it('loadSessionId returns null when session file does not exist', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    adapter.setRoomId('room-1');
    const loadSessionId = (adapter as unknown as { loadSessionId(): string | null }).loadSessionId.bind(adapter);
    expect(loadSessionId()).toBeNull();
  });

  it('loadSessionId returns session ID from existing file', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    adapter.setRoomId('room-1');

    mkdirSync(join(tempDir, '.skynet'), { recursive: true });
    writeFileSync(sessionStorePath, JSON.stringify({ 'room-1': 'session-abc' }));

    const loadSessionId = (adapter as unknown as { loadSessionId(): string | null }).loadSessionId.bind(adapter);
    expect(loadSessionId()).toBe('session-abc');
  });

  it('loadSessionId returns null for unknown room', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    adapter.setRoomId('room-2');

    mkdirSync(join(tempDir, '.skynet'), { recursive: true });
    writeFileSync(sessionStorePath, JSON.stringify({ 'room-1': 'session-abc' }));

    const loadSessionId = (adapter as unknown as { loadSessionId(): string | null }).loadSessionId.bind(adapter);
    expect(loadSessionId()).toBeNull();
  });

  it('saveSessionId creates file and directory', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    adapter.setRoomId('room-1');

    const saveSessionId = (adapter as unknown as { saveSessionId(id: string): void }).saveSessionId.bind(adapter);
    saveSessionId('session-xyz');

    const data = JSON.parse(readFileSync(sessionStorePath, 'utf-8'));
    expect(data).toEqual({ 'room-1': 'session-xyz' });
  });

  it('saveSessionId preserves other rooms', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    adapter.setRoomId('room-2');

    mkdirSync(join(tempDir, '.skynet'), { recursive: true });
    writeFileSync(sessionStorePath, JSON.stringify({ 'room-1': 'session-abc' }));

    const saveSessionId = (adapter as unknown as { saveSessionId(id: string): void }).saveSessionId.bind(adapter);
    saveSessionId('session-def');

    const data = JSON.parse(readFileSync(sessionStorePath, 'utf-8'));
    expect(data).toEqual({ 'room-1': 'session-abc', 'room-2': 'session-def' });
  });

  it('saveSessionId is a no-op when no room is set', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    const saveSessionId = (adapter as unknown as { saveSessionId(id: string): void }).saveSessionId.bind(adapter);
    saveSessionId('session-xyz');

    // File should not be created
    expect(() => readFileSync(sessionStorePath)).toThrow();
  });

  it('setRoomId sets the room ID', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir, sessionStorePath });
    adapter.setRoomId('my-room');

    mkdirSync(join(tempDir, '.skynet'), { recursive: true });
    writeFileSync(sessionStorePath, JSON.stringify({ 'my-room': 'sess-123' }));

    const loadSessionId = (adapter as unknown as { loadSessionId(): string | null }).loadSessionId.bind(adapter);
    expect(loadSessionId()).toBe('sess-123');
  });

  it('uses default sessionStorePath based on projectRoot', () => {
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    adapter.setRoomId('room-1');

    const defaultPath = join(tempDir, '.skynet', 'sessions.json');
    const saveSessionId = (adapter as unknown as { saveSessionId(id: string): void }).saveSessionId.bind(adapter);
    saveSessionId('session-default');

    const data = JSON.parse(readFileSync(defaultPath, 'utf-8'));
    expect(data).toEqual({ 'room-1': 'session-default' });
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

  it('calls execa with separate args instead of shell string', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const msg = {
      id: 'msg-1',
      type: MessageType.CHAT as const,
      from: 'human-123',
      to: null,
      roomId: 'room-1',
      timestamp: Date.now(),
      payload: { text: 'hello "world" $HOME' },
    };

    const result = await adapter.handleMessage(msg);

    expect(execa).toHaveBeenCalledWith(
      'claude',
      ['-p', 'Message from human-123: hello "world" $HOME', '--output-format', 'text'],
      expect.objectContaining({ cwd: tempDir, timeout: 300_000 }),
    );
    expect(result).toBe('mock response');
  });

  it('uses senderName instead of agentId in prompt when provided', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const msg = {
      id: 'msg-1',
      type: MessageType.CHAT as const,
      from: '6242e06d-f2e8-4d16-ac87-85ad62d37635',
      to: null,
      roomId: 'room-1',
      timestamp: Date.now(),
      payload: { text: '你是谁' },
    };

    await adapter.handleMessage(msg, 'Alice');

    expect(execa).toHaveBeenCalledWith(
      'claude',
      ['-p', 'Message from Alice: 你是谁', '--output-format', 'text'],
      expect.any(Object),
    );
  });

  it('falls back to agentId when senderName is not provided', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });

    const msg = {
      id: 'msg-1',
      type: MessageType.CHAT as const,
      from: 'agent-xyz',
      to: null,
      roomId: 'room-1',
      timestamp: Date.now(),
      payload: { text: 'hello' },
    };

    await adapter.handleMessage(msg);

    expect(execa).toHaveBeenCalledWith(
      'claude',
      ['-p', 'Message from agent-xyz: hello', '--output-format', 'text'],
      expect.any(Object),
    );
  });

  it('includes --resume flag when session exists', async () => {
    const { execa } = await import('execa');
    const adapter = new ClaudeCodeAdapter({ projectRoot: tempDir });
    adapter.setRoomId('room-1');

    mkdirSync(join(tempDir, '.skynet'), { recursive: true });
    writeFileSync(join(tempDir, '.skynet', 'sessions.json'), JSON.stringify({ 'room-1': 'sess-abc' }));

    const msg = {
      id: 'msg-1',
      type: MessageType.CHAT as const,
      from: 'human-123',
      to: null,
      roomId: 'room-1',
      timestamp: Date.now(),
      payload: { text: 'test' },
    };

    await adapter.handleMessage(msg);

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--resume', 'sess-abc']),
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

    const msg = {
      id: 'msg-1',
      type: MessageType.CHAT as const,
      from: 'human-123',
      to: null,
      roomId: 'room-1',
      timestamp: Date.now(),
      payload: { text: 'test' },
    };

    await adapter.handleMessage(msg);

    expect(execa).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--model', 'opus', '--allowedTools', 'Read,Write']),
      expect.any(Object),
    );
  });
});
