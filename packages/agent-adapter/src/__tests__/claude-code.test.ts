import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';

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
