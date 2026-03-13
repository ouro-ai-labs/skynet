import { describe, it, expect } from 'vitest';
import { AgentType, MessageType } from '@skynet-ai/protocol';
import { GeminiCliAdapter } from '../../adapters/gemini-cli.js';

function makeMsg(text = 'hello') {
  return {
    id: 'msg-1',
    type: MessageType.CHAT as const,
    from: 'human-1',
    timestamp: Date.now(),
    payload: { text },
  };
}

describe('GeminiCliAdapter', () => {
  it('has type GEMINI_CLI and name gemini-cli', () => {
    const adapter = new GeminiCliAdapter({ projectRoot: '/project' });
    expect(adapter.type).toBe(AgentType.GEMINI_CLI);
    expect(adapter.name).toBe('gemini-cli');
  });

  it('isAvailable returns false (stub)', async () => {
    const adapter = new GeminiCliAdapter({ projectRoot: '/project' });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('handleMessage throws not-implemented error', async () => {
    const adapter = new GeminiCliAdapter({ projectRoot: '/project' });
    await expect(adapter.handleMessage(makeMsg())).rejects.toThrow(
      'GeminiCliAdapter is not yet implemented',
    );
  });

  it('executeTask throws not-implemented error', async () => {
    const adapter = new GeminiCliAdapter({ projectRoot: '/project' });
    await expect(
      adapter.executeTask({
        taskId: 't1',
        title: 'Task',
        description: 'Desc',
        status: 'assigned',
      }),
    ).rejects.toThrow('GeminiCliAdapter is not yet implemented');
  });

  it('dispose resolves without error', async () => {
    const adapter = new GeminiCliAdapter({ projectRoot: '/project' });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});
