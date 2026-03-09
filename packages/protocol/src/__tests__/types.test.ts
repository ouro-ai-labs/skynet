import { describe, it, expect } from 'vitest';
import { AgentType, MessageType, MAX_ATTACHMENT_SIZE } from '../types.js';
import type { Attachment, ChatPayload } from '../types.js';

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

describe('Attachment types', () => {
  it('MAX_ATTACHMENT_SIZE is 5MB', () => {
    expect(MAX_ATTACHMENT_SIZE).toBe(5 * 1024 * 1024);
  });

  it('Attachment interface accepts image type', () => {
    const att: Attachment = {
      type: 'image',
      mimeType: 'image/png',
      name: 'test.png',
      data: 'base64data',
      size: 1024,
    };
    expect(att.type).toBe('image');
    expect(att.mimeType).toBe('image/png');
  });

  it('ChatPayload accepts optional attachments', () => {
    const withAttachments: ChatPayload = {
      text: 'hello',
      attachments: [{
        type: 'image',
        mimeType: 'image/png',
        name: 'test.png',
        data: 'base64data',
        size: 1024,
      }],
    };
    expect(withAttachments.attachments).toHaveLength(1);

    const withoutAttachments: ChatPayload = { text: 'hello' };
    expect(withoutAttachments.attachments).toBeUndefined();
  });
});
