import { describe, it, expect } from 'vitest';
import { AgentType, MessageType } from '../types.js';

describe('AgentType enum', () => {
  it('has all expected agent types', () => {
    expect(AgentType.CLAUDE_CODE).toBe('claude-code');
    expect(AgentType.GEMINI_CLI).toBe('gemini-cli');
    expect(AgentType.CODEX_CLI).toBe('codex-cli');
    expect(AgentType.HUMAN).toBe('human');
    expect(AgentType.MONITOR).toBe('monitor');
    expect(AgentType.GENERIC).toBe('generic');
  });
});

describe('MessageType enum', () => {
  it('has system message types', () => {
    expect(MessageType.AGENT_JOIN).toBe('agent.join');
    expect(MessageType.AGENT_LEAVE).toBe('agent.leave');
    expect(MessageType.AGENT_HEARTBEAT).toBe('agent.heartbeat');
  });

  it('has collaboration message types', () => {
    expect(MessageType.CHAT).toBe('chat');
    expect(MessageType.TASK_ASSIGN).toBe('task.assign');
    expect(MessageType.TASK_UPDATE).toBe('task.update');
    expect(MessageType.TASK_RESULT).toBe('task.result');
  });

  it('has context sharing types', () => {
    expect(MessageType.CONTEXT_SHARE).toBe('context.share');
    expect(MessageType.FILE_CHANGE).toBe('file.change');
  });
});
