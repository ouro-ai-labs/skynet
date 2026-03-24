import { describe, it, expect } from 'vitest';
import { AgentType, MessageType, type AgentCard, type SkynetMessage } from '@skynet-ai/protocol';
import { formatForWeixin, chunkMessage, createAgentResolver } from '../weixin-fmt.js';

const members = new Map<string, AgentCard>([
  ['agent-1', { id: 'agent-1', name: 'alice', type: AgentType.CLAUDE_CODE, capabilities: [], status: 'idle' }],
  ['agent-2', { id: 'agent-2', name: 'bob', type: AgentType.GEMINI_CLI, capabilities: [], status: 'idle' }],
  ['human-1', { id: 'human-1', name: 'yixin', type: AgentType.HUMAN, capabilities: ['chat'], status: 'idle' }],
]);

const resolve = createAgentResolver(members);

describe('formatForWeixin', () => {
  it('formats chat messages with sender name and text', () => {
    const msg: SkynetMessage = {
      id: 'msg-1',
      type: MessageType.CHAT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { text: 'Hello from Alice' },
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[alice]\nHello from Alice');
  });

  it('formats chat messages with mentions', () => {
    const msg: SkynetMessage = {
      id: 'msg-2',
      type: MessageType.CHAT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { text: 'Hey @bob check this' },
      mentions: ['agent-2'],
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[alice] -> @bob\nHey @bob check this');
  });

  it('formats chat messages with @all mention', () => {
    const msg: SkynetMessage = {
      id: 'msg-3',
      type: MessageType.CHAT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { text: 'Attention everyone' },
      mentions: ['__all__'],
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[alice] -> @all\nAttention everyone');
  });

  it('formats task assign', () => {
    const msg: SkynetMessage = {
      id: 'msg-4',
      type: MessageType.TASK_ASSIGN,
      from: 'human-1',
      timestamp: Date.now(),
      payload: { taskId: 'task-1', title: 'Fix bug #42', description: 'details', assignee: 'agent-1' },
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[yixin] Task: "Fix bug #42" -> alice');
  });

  it('formats task result success', () => {
    const msg: SkynetMessage = {
      id: 'msg-5',
      type: MessageType.TASK_RESULT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { taskId: 'task-1', success: true, summary: 'Bug fixed' },
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[alice] Result [OK]: Bug fixed');
  });

  it('formats task result failure', () => {
    const msg: SkynetMessage = {
      id: 'msg-6',
      type: MessageType.TASK_RESULT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { taskId: 'task-1', success: false, summary: 'Could not reproduce' },
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[alice] Result [FAIL]: Could not reproduce');
  });

  it('formats agent join', () => {
    const msg: SkynetMessage = {
      id: 'msg-7',
      type: MessageType.AGENT_JOIN,
      from: 'system',
      timestamp: Date.now(),
      payload: { agent: { id: 'agent-3', name: 'charlie', type: AgentType.CODEX_CLI, capabilities: [], status: 'idle' } },
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[System] charlie joined');
  });

  it('formats agent leave', () => {
    const msg: SkynetMessage = {
      id: 'msg-8',
      type: MessageType.AGENT_LEAVE,
      from: 'system',
      timestamp: Date.now(),
      payload: { agentId: 'agent-2' },
    };
    const result = formatForWeixin(msg, resolve);
    expect(result).toBe('[System] bob left');
  });

  it('returns null for execution logs', () => {
    const msg: SkynetMessage = {
      id: 'msg-9',
      type: MessageType.EXECUTION_LOG,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { event: 'tool.call', summary: 'Read file', level: 'info' },
    };
    expect(formatForWeixin(msg, resolve)).toBeNull();
  });

  it('falls back gracefully for unknown agent IDs', () => {
    const msg: SkynetMessage = {
      id: 'msg-10',
      type: MessageType.CHAT,
      from: 'unknown-agent-id-12345678',
      timestamp: Date.now(),
      payload: { text: 'Ghost message' },
    };
    const result = formatForWeixin(msg, resolve);
    // createAgentResolver returns first 8 chars of ID for unknown agents
    expect(result).toBe('[unknown-]\nGhost message');
  });

  it('output contains no ANSI escape codes', () => {
    const msg: SkynetMessage = {
      id: 'msg-11',
      type: MessageType.CHAT,
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { text: 'Test message' },
    };
    const result = formatForWeixin(msg, resolve)!;
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/\u001b\[/);
  });
});

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits at paragraph boundary', () => {
    const text = 'A'.repeat(50) + '\n\n' + 'B'.repeat(50);
    const chunks = chunkMessage(text, 60);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('A'.repeat(50));
    expect(chunks[1]).toBe('B'.repeat(50));
  });

  it('splits at newline when no paragraph boundary', () => {
    const text = 'A'.repeat(50) + '\n' + 'B'.repeat(50);
    const chunks = chunkMessage(text, 60);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('A'.repeat(50));
    expect(chunks[1]).toBe('B'.repeat(50));
  });

  it('hard splits when no newline available', () => {
    const text = 'A'.repeat(100);
    const chunks = chunkMessage(text, 60);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('A'.repeat(60));
    expect(chunks[1]).toBe('A'.repeat(40));
  });
});
