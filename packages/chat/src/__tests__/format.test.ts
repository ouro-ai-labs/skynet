import { describe, it, expect } from 'vitest';
import {
  AgentType,
  MessageType,
  type SkynetMessage,
  type AgentCard,
} from '@skynet/protocol';
import {
  agentTag,
  agentNameColored,
  dimText,
  formatTimestamp,
  formatMessage,
  formatSystemMessage,
  createAgentResolver,
  AGENT_COLORS,
  AGENT_LABELS,
} from '../format.js';
import chalk from 'chalk';

// Force chalk to output ANSI codes in test (no TTY)
chalk.level = 3;

// ── Helpers ──

function makeMsg(overrides: Partial<SkynetMessage> & Pick<SkynetMessage, 'type' | 'payload'>): SkynetMessage {
  return {
    id: 'msg-1',
    from: 'agent-1',
    to: null,
    roomId: 'room-1',
    timestamp: new Date('2026-03-05T14:30:00').getTime(),
    ...overrides,
  };
}

function makeCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    agentId: 'agent-1',
    name: 'Alice',
    type: AgentType.HUMAN,
    capabilities: ['chat'],
    status: 'idle',
    ...overrides,
  };
}

const aliceCard = makeCard({ agentId: 'agent-1', name: 'Alice', type: AgentType.HUMAN });
const bobCard = makeCard({ agentId: 'agent-2', name: 'Bob', type: AgentType.CLAUDE_CODE });

function makeResolver() {
  const members = new Map<string, AgentCard>();
  members.set('agent-1', aliceCard);
  members.set('agent-2', bobCard);
  return createAgentResolver(members);
}

// Strip ANSI escape codes for easier assertions
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

// ── Tests ──

describe('agentTag', () => {
  it('returns tag text for known types', () => {
    const tag = agentTag(AgentType.CLAUDE_CODE);
    expect(stripAnsi(tag)).toBe('Claude');
  });

  it('returns tag text for human', () => {
    const tag = agentTag(AgentType.HUMAN);
    expect(stripAnsi(tag)).toBe('Human');
  });
});

describe('agentNameColored', () => {
  it('wraps name with color and bold', () => {
    const result = agentNameColored('Alice', AgentType.HUMAN);
    expect(stripAnsi(result)).toBe('Alice');
    // Should contain ANSI codes (i.e. not be plain)
    expect(result).not.toBe('Alice');
  });
});

describe('dimText', () => {
  it('wraps text with dim color', () => {
    const result = dimText('hello');
    expect(stripAnsi(result)).toBe('hello');
    expect(result).not.toBe('hello');
  });
});

describe('formatTimestamp', () => {
  it('formats as HH:MM', () => {
    const ms = new Date('2026-03-05T09:05:00').getTime();
    const result = formatTimestamp(ms);
    expect(stripAnsi(result)).toContain('09:05');
  });
});

describe('createAgentResolver', () => {
  it('resolves known agent to name and type', () => {
    const resolve = makeResolver();
    const result = resolve('agent-1');
    expect(result).toEqual({ name: 'Alice', type: AgentType.HUMAN });
  });

  it('falls back to truncated ID for unknown agent', () => {
    const resolve = makeResolver();
    const result = resolve('unknown-agent-id-12345');
    expect(result.name).toBe('unknown-');
    expect(result.type).toBe(AgentType.GENERIC);
  });
});

describe('formatMessage', () => {
  const resolve = makeResolver();

  it('formats chat messages with sender name', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: 'Hello world' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines).toHaveLength(1);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('Alice');
    expect(plain).toContain('Hello world');
  });

  it('formats chat DM with receiver', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      to: 'agent-2',
      payload: { text: 'secret message' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('Alice');
    expect(plain).toContain('Bob');
    expect(plain).toContain('secret message');
    expect(plain).toContain('->');
  });

  it('formats task assignment', () => {
    const msg = makeMsg({
      type: MessageType.TASK_ASSIGN,
      payload: { taskId: 'task-1', title: 'Fix bug', description: 'Fix the bug', assignee: 'agent-2', status: 'pending' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('◆');
    expect(plain).toContain('task');
    expect(plain).toContain('Alice');
    expect(plain).toContain('Fix bug');
    expect(plain).toContain('Bob');
  });

  it('formats task result success', () => {
    const msg = makeMsg({
      type: MessageType.TASK_RESULT,
      payload: { taskId: 'task-1', success: true, summary: 'All good' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('◆');
    expect(plain).toContain('result');
    expect(plain).toContain('OK');
    expect(plain).toContain('All good');
  });

  it('formats task result failure', () => {
    const msg = makeMsg({
      type: MessageType.TASK_RESULT,
      payload: { taskId: 'task-1', success: false, summary: 'Something broke' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('FAIL');
    expect(plain).toContain('Something broke');
  });

  it('formats task update', () => {
    const msg = makeMsg({
      type: MessageType.TASK_UPDATE,
      payload: { taskId: 'abcdef1234567890', status: 'in-progress' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('◆');
    expect(plain).toContain('task');
    expect(plain).toContain('in-progress');
    expect(plain).toContain('abcdef12');
  });

  it('formats context share', () => {
    const msg = makeMsg({
      type: MessageType.CONTEXT_SHARE,
      payload: { files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('◇');
    expect(plain).toContain('context');
    expect(plain).toContain('2 file(s)');
  });

  it('formats file change', () => {
    const msg = makeMsg({
      type: MessageType.FILE_CHANGE,
      payload: { path: 'src/index.ts', changeType: 'modified', agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('~ modified');
    expect(plain).toContain('Bob');
    expect(plain).toContain('src/index.ts');
  });

  it('formats agent join', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_JOIN,
      payload: { agent: bobCard },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('Bob');
    expect(plain).toContain('joined');
    expect(plain).toContain('Claude');
  });

  it('formats agent leave', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_LEAVE,
      payload: { agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('Bob');
    expect(plain).toContain('left');
  });

  it('formats unknown message types with JSON payload', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_HEARTBEAT,
      payload: { agentId: 'agent-1', status: 'idle' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    expect(plain).toContain('agent.heartbeat');
  });

  it('splits multi-line chat text into separate lines', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: 'Line one\nLine two\nLine three' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines).toHaveLength(3);
    const plain0 = stripAnsi(lines[0]);
    expect(plain0).toContain('Alice');
    expect(plain0).toContain('Line one');
    const plain1 = stripAnsi(lines[1]);
    expect(plain1).toContain('Line two');
    expect(plain1).not.toContain('Alice');
    const plain2 = stripAnsi(lines[2]);
    expect(plain2).toContain('Line three');
  });

  it('does not escape curly braces (no more blessed markup)', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: '{bold}test{/bold}' },
    });
    const lines = formatMessage(msg, resolve);
    const plain = stripAnsi(lines[0]);
    // Chalk-based format passes text through as-is
    expect(plain).toContain('{bold}test{/bold}');
  });
});

describe('formatSystemMessage', () => {
  it('wraps text in dim formatting', () => {
    const result = formatSystemMessage('hello');
    const plain = stripAnsi(result);
    expect(plain).toContain('·');
    expect(plain).toContain('hello');
  });
});

describe('AGENT_LABELS', () => {
  it('has labels for all AgentType values', () => {
    for (const type of Object.values(AgentType)) {
      expect(AGENT_LABELS[type]).toBeDefined();
    }
  });
});

describe('AGENT_COLORS', () => {
  it('has colors for all AgentType values', () => {
    for (const type of Object.values(AgentType)) {
      expect(AGENT_COLORS[type]).toBeDefined();
      expect(AGENT_COLORS[type]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
