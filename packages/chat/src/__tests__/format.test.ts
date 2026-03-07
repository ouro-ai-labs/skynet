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
  formatMemberList,
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
    timestamp: new Date('2026-03-05T14:30:00').getTime(),
    ...overrides,
  };
}

function makeCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    id: 'agent-1',
    name: 'Alice',
    type: AgentType.HUMAN,
    capabilities: ['chat'],
    status: 'idle',
    ...overrides,
  };
}

const aliceCard = makeCard({ id: 'agent-1', name: 'Alice', type: AgentType.HUMAN });
const bobCard = makeCard({ id: 'agent-2', name: 'Bob', type: AgentType.CLAUDE_CODE });

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

  it('formats chat messages with marker header and continuation body', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: 'Hello world' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const headerPlain = stripAnsi(lines[0]);
    // Header has marker, name, and timestamp
    expect(headerPlain).toContain('\u23FA');
    expect(headerPlain).toContain('Alice');
    expect(headerPlain).toContain('(14:30)');
    // Body has continuation marker
    const bodyPlain = stripAnsi(lines[1]);
    expect(bodyPlain).toContain('\u23BF');
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('Hello world');
    expect(lines[lines.length - 1]).toBe('');
  });

  it('formats chat DM with receiver in header', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      to: 'agent-2',
      payload: { text: 'secret message' },
    });
    const lines = formatMessage(msg, resolve);
    const headerPlain = stripAnsi(lines[0]);
    expect(headerPlain).toContain('Alice');
    expect(headerPlain).toContain('Bob');
    expect(headerPlain).toContain('->');
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('secret message');
  });

  it('formats task assignment with marker style', () => {
    const msg = makeMsg({
      type: MessageType.TASK_ASSIGN,
      payload: { taskId: 'task-1', title: 'Fix bug', description: 'Fix the bug', assignee: 'agent-2', status: 'pending' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('\u25C6');
    expect(allPlain).toContain('task');
    expect(allPlain).toContain('Alice');
    expect(allPlain).toContain('Fix bug');
    expect(allPlain).toContain('Bob');
    expect(lines[lines.length - 1]).toBe('');
  });

  it('formats task result success', () => {
    const msg = makeMsg({
      type: MessageType.TASK_RESULT,
      payload: { taskId: 'task-1', success: true, summary: 'All good' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('\u25C6');
    expect(allPlain).toContain('result');
    expect(allPlain).toContain('OK');
    expect(allPlain).toContain('All good');
  });

  it('formats task result failure', () => {
    const msg = makeMsg({
      type: MessageType.TASK_RESULT,
      payload: { taskId: 'task-1', success: false, summary: 'Something broke' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('FAIL');
    expect(allPlain).toContain('Something broke');
  });

  it('formats task update', () => {
    const msg = makeMsg({
      type: MessageType.TASK_UPDATE,
      payload: { taskId: 'abcdef1234567890', status: 'in-progress' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('\u25C6');
    expect(allPlain).toContain('task');
    expect(allPlain).toContain('in-progress');
    expect(allPlain).toContain('abcdef12');
  });

  it('formats context share', () => {
    const msg = makeMsg({
      type: MessageType.CONTEXT_SHARE,
      payload: { files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('\u25C7');
    expect(allPlain).toContain('shared');
    expect(allPlain).toContain('2 file(s)');
  });

  it('formats file change', () => {
    const msg = makeMsg({
      type: MessageType.FILE_CHANGE,
      payload: { path: 'src/index.ts', changeType: 'modified', agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('~');
    expect(allPlain).toContain('Bob');
    expect(allPlain).toContain('src/index.ts');
  });

  it('formats agent join with marker style', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_JOIN,
      payload: { agent: bobCard },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('system');
    expect(allPlain).toContain('Bob');
    expect(allPlain).toContain('joined');
    expect(allPlain).toContain('Claude');
  });

  it('formats agent leave with marker style', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_LEAVE,
      payload: { agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('system');
    expect(allPlain).toContain('Bob');
    expect(allPlain).toContain('left');
  });

  it('formats unknown message types with JSON payload', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_HEARTBEAT,
      payload: { agentId: 'agent-1', status: 'idle' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('agent.heartbeat');
  });

  it('passes through curly braces in markdown body', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: '{bold}test{/bold}' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('{bold}test{/bold}');
  });
});

describe('formatSystemMessage', () => {
  it('wraps text in marker style with system label', () => {
    const result = formatSystemMessage('hello');
    const plain = stripAnsi(result);
    expect(plain).toContain('\u23FA');
    expect(plain).toContain('system');
    expect(plain).toContain('hello');
  });
});

describe('formatMessage spacing', () => {
  const resolve = makeResolver();

  it('chat messages end with blank separator line', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: 'hello' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[lines.length - 1]).toBe('');
  });

  it('task messages end with blank separator line', () => {
    const msg = makeMsg({
      type: MessageType.TASK_ASSIGN,
      payload: { taskId: 't1', title: 'Do it', description: '', assignee: null, status: 'pending' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[lines.length - 1]).toBe('');
  });

  it('join messages end with blank separator line', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_JOIN,
      payload: { agent: bobCard },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[lines.length - 1]).toBe('');
  });

  it('leave messages end with blank separator line', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_LEAVE,
      payload: { agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[lines.length - 1]).toBe('');
  });

  it('renders markdown bold in chat body', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: 'this is **bold** text' },
    });
    const lines = formatMessage(msg, resolve);
    const bodyLines = lines.slice(1, -1);
    const bodyText = bodyLines.join('\n');
    const plainBody = stripAnsi(bodyText);
    expect(plainBody).toContain('bold');
    expect(bodyText).not.toBe(plainBody);
  });

  it('renders markdown code blocks in chat body', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: '```\nconst x = 1;\n```' },
    });
    const lines = formatMessage(msg, resolve);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('const x = 1;');
  });

  it('chat body first line has continuation marker', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: 'hello' },
    });
    const lines = formatMessage(msg, resolve);
    const bodyPlain = stripAnsi(lines[1]);
    expect(bodyPlain).toContain('\u23BF');
  });
});

describe('formatMemberList', () => {
  it('lists members with status icons and agent types', () => {
    const members = new Map<string, AgentCard>();
    members.set('agent-1', aliceCard);
    members.set('agent-2', bobCard);
    const lines = formatMemberList(members, 'agent-1');
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('members');
    expect(allPlain).toContain('(2)');
    expect(allPlain).toContain('Alice');
    expect(allPlain).toContain('Bob');
    expect(allPlain).toContain('(you)');
    expect(lines[lines.length - 1]).toBe('');
  });

  it('shows busy status for busy members', () => {
    const members = new Map<string, AgentCard>();
    const busyBob = makeCard({ id: 'agent-2', name: 'Bob', type: AgentType.CLAUDE_CODE, status: 'busy' });
    members.set('agent-2', busyBob);
    const lines = formatMemberList(members);
    const allPlain = lines.map(stripAnsi).join('\n');
    expect(allPlain).toContain('\u25D0');
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
