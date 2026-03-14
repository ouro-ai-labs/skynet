import { describe, it, expect } from 'vitest';
import { createExecutionLog } from '../utils.js';
import { MessageType } from '../types.js';
import type { ExecutionLogPayload } from '../types.js';

describe('createExecutionLog', () => {
  it('creates an execution log message with correct type and fields', () => {
    const msg = createExecutionLog('agent-1', 'tool.call', 'Read file.ts');

    expect(msg.type).toBe(MessageType.EXECUTION_LOG);
    expect(msg.from).toBe('agent-1');
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeGreaterThan(0);

    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.event).toBe('tool.call');
    expect(payload.summary).toBe('Read file.ts');
    expect(payload.level).toBe('info');
  });

  it('defaults level to info', () => {
    const msg = createExecutionLog('agent-1', 'processing.start', 'Starting');
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.level).toBe('info');
  });

  it('accepts custom level', () => {
    const msg = createExecutionLog('agent-1', 'processing.error', 'Failed', { level: 'error' });
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.level).toBe('error');
  });

  it('includes durationMs when provided', () => {
    const msg = createExecutionLog('agent-1', 'processing.end', 'Done', { durationMs: 1500 });
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.durationMs).toBe(1500);
  });

  it('omits durationMs when not provided', () => {
    const msg = createExecutionLog('agent-1', 'tool.call', 'Read');
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.durationMs).toBeUndefined();
  });

  it('includes sourceMessageId when provided', () => {
    const msg = createExecutionLog('agent-1', 'tool.call', 'Read', { sourceMessageId: 'msg-123' });
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.sourceMessageId).toBe('msg-123');
  });

  it('includes metadata when provided', () => {
    const meta = { input: { file_path: '/foo.ts' } };
    const msg = createExecutionLog('agent-1', 'tool.call', 'Read', { metadata: meta });
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.metadata).toEqual(meta);
  });

  it('omits optional fields when not provided', () => {
    const msg = createExecutionLog('agent-1', 'thinking', 'Analyzing code');
    const payload = msg.payload as ExecutionLogPayload;
    expect(payload.durationMs).toBeUndefined();
    expect(payload.sourceMessageId).toBeUndefined();
    expect(payload.metadata).toBeUndefined();
  });

  it('sends no mentions (execution logs have no mentions)', () => {
    const msg = createExecutionLog('agent-1', 'tool.call', 'Read');
    expect(msg.mentions).toBeUndefined();
  });

  it('supports all event types', () => {
    const events = [
      'processing.start',
      'processing.end',
      'processing.error',
      'tool.call',
      'tool.result',
      'thinking',
      'custom',
    ] as const;

    for (const event of events) {
      const msg = createExecutionLog('agent-1', event, `test ${event}`);
      const payload = msg.payload as ExecutionLogPayload;
      expect(payload.event).toBe(event);
    }
  });
});
