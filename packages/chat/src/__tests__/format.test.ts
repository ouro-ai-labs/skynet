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
  escapeMarkup,
  formatTimestamp,
  formatMessage,
  formatSystemMessage,
  createAgentResolver,
  AGENT_COLORS,
  AGENT_LABELS,
} from '../format.js';

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

// ── Tests ──

describe('escapeMarkup', () => {
  it('escapes curly braces', () => {
    expect(escapeMarkup('hello {world}')).toBe('hello {open}world{close}');
  });

  it('returns plain text unchanged', () => {
    expect(escapeMarkup('plain text')).toBe('plain text');
  });
});

describe('agentTag', () => {
  it('returns colored tag for known types', () => {
    const tag = agentTag(AgentType.CLAUDE_CODE);
    expect(tag).toContain('Claude');
    expect(tag).toContain(AGENT_COLORS[AgentType.CLAUDE_CODE]);
  });

  it('returns colored tag for human', () => {
    const tag = agentTag(AgentType.HUMAN);
    expect(tag).toContain('Human');
  });
});

describe('agentNameColored', () => {
  it('wraps name in color and bold tags', () => {
    const result = agentNameColored('Alice', AgentType.HUMAN);
    expect(result).toContain('Alice');
    expect(result).toContain('{bold}');
    expect(result).toContain(AGENT_COLORS[AgentType.HUMAN]);
  });
});

describe('dimText', () => {
  it('wraps text in dim color tags', () => {
    const result = dimText('hello');
    expect(result).toBe('{#666666-fg}hello{/#666666-fg}');
  });
});

describe('formatTimestamp', () => {
  it('formats as HH:MM in dim color', () => {
    const ms = new Date('2026-03-05T09:05:00').getTime();
    const result = formatTimestamp(ms);
    expect(result).toContain('09:05');
    expect(result).toContain('#666666');
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
    expect(lines[0]).toContain('Alice');
    expect(lines[0]).toContain('Hello world');
  });

  it('formats chat DM with receiver', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      to: 'agent-2',
      payload: { text: 'secret message' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('Alice');
    expect(lines[0]).toContain('Bob');
    expect(lines[0]).toContain('secret message');
    expect(lines[0]).toContain('->');
  });

  it('formats task assignment', () => {
    const msg = makeMsg({
      type: MessageType.TASK_ASSIGN,
      payload: { taskId: 'task-1', title: 'Fix bug', description: 'Fix the bug', assignee: 'agent-2', status: 'pending' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('[task]');
    expect(lines[0]).toContain('Alice');
    expect(lines[0]).toContain('Fix bug');
    expect(lines[0]).toContain('Bob');
  });

  it('formats task result success', () => {
    const msg = makeMsg({
      type: MessageType.TASK_RESULT,
      payload: { taskId: 'task-1', success: true, summary: 'All good' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('[result]');
    expect(lines[0]).toContain('OK');
    expect(lines[0]).toContain('All good');
  });

  it('formats task result failure', () => {
    const msg = makeMsg({
      type: MessageType.TASK_RESULT,
      payload: { taskId: 'task-1', success: false, summary: 'Something broke' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('FAIL');
    expect(lines[0]).toContain('Something broke');
  });

  it('formats task update', () => {
    const msg = makeMsg({
      type: MessageType.TASK_UPDATE,
      payload: { taskId: 'abcdef1234567890', status: 'in-progress' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('[task]');
    expect(lines[0]).toContain('in-progress');
    expect(lines[0]).toContain('abcdef12');
  });

  it('formats context share', () => {
    const msg = makeMsg({
      type: MessageType.CONTEXT_SHARE,
      payload: { files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('[context]');
    expect(lines[0]).toContain('2 file(s)');
  });

  it('formats file change', () => {
    const msg = makeMsg({
      type: MessageType.FILE_CHANGE,
      payload: { path: 'src/index.ts', changeType: 'modified', agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('[modified]');
    expect(lines[0]).toContain('Bob');
    expect(lines[0]).toContain('src/index.ts');
  });

  it('formats agent join', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_JOIN,
      payload: { agent: bobCard },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('Bob');
    expect(lines[0]).toContain('joined');
    expect(lines[0]).toContain('Claude');
  });

  it('formats agent leave', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_LEAVE,
      payload: { agentId: 'agent-2' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('Bob');
    expect(lines[0]).toContain('left');
  });

  it('formats unknown message types with JSON payload', () => {
    const msg = makeMsg({
      type: MessageType.AGENT_HEARTBEAT,
      payload: { agentId: 'agent-1', status: 'idle' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('agent.heartbeat');
  });

  it('escapes markup in user content', () => {
    const msg = makeMsg({
      type: MessageType.CHAT,
      payload: { text: '{bold}hack{/bold}' },
    });
    const lines = formatMessage(msg, resolve);
    expect(lines[0]).toContain('{open}bold{close}');
    expect(lines[0]).not.toContain('{bold}hack{/bold}');
  });
});

describe('formatSystemMessage', () => {
  it('wraps text in dim formatting', () => {
    const result = formatSystemMessage('hello');
    expect(result).toContain('--');
    expect(result).toContain('hello');
    expect(result).toContain('#666666');
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
