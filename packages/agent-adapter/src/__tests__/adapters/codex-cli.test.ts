import { describe, it, expect } from 'vitest';
import { AgentType, MessageType } from '@skynet-ai/protocol';
import { CodexCliAdapter } from '../../adapters/codex-cli.js';

function makeMsg(text = 'hello') {
  return {
    id: 'msg-1',
    type: MessageType.CHAT as const,
    from: 'human-1',
    timestamp: Date.now(),
    payload: { text },
  };
}

describe('CodexCliAdapter', () => {
  it('has type CODEX_CLI and name codex-cli', () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project' });
    expect(adapter.type).toBe(AgentType.CODEX_CLI);
    expect(adapter.name).toBe('codex-cli');
  });

  it('isAvailable returns false (stub)', async () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project' });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('handleMessage throws not-implemented error', async () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project' });
    await expect(adapter.handleMessage(makeMsg())).rejects.toThrow(
      'CodexCliAdapter is not yet implemented',
    );
  });

  it('executeTask throws not-implemented error', async () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project' });
    await expect(
      adapter.executeTask({
        taskId: 't1',
        title: 'Task',
        description: 'Desc',
        status: 'assigned',
      }),
    ).rejects.toThrow('CodexCliAdapter is not yet implemented');
  });

  it('dispose resolves without error', async () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project' });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });

  it('accepts fullAuto option without error', () => {
    const adapter = new CodexCliAdapter({ projectRoot: '/project', fullAuto: true });
    expect(adapter.type).toBe(AgentType.CODEX_CLI);
  });
});
