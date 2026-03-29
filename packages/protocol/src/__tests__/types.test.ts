import { describe, it, expect } from 'vitest';
import { AgentType, MessageType, MAX_ATTACHMENT_SIZE } from '../types.js';
import type { Attachment, ChatPayload, ScheduleInfo, ScheduleCreatePayload } from '../types.js';

describe('AgentType enum', () => {
  it('has all expected agent types', () => {
    expect(AgentType.CLAUDE_CODE).toBe('claude-code');
    expect(AgentType.GEMINI_CLI).toBe('gemini-cli');
    expect(AgentType.CODEX_CLI).toBe('codex-cli');
    expect(AgentType.OPENCODE).toBe('opencode');
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

  it('has schedule message types', () => {
    expect(MessageType.SCHEDULE_CREATE).toBe('schedule.create');
    expect(MessageType.SCHEDULE_UPDATE).toBe('schedule.update');
    expect(MessageType.SCHEDULE_DELETE).toBe('schedule.delete');
    expect(MessageType.SCHEDULE_LIST).toBe('schedule.list');
    expect(MessageType.SCHEDULE_TRIGGER).toBe('schedule.trigger');
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

describe('Schedule types', () => {
  it('ScheduleInfo has required fields', () => {
    const schedule: ScheduleInfo = {
      id: 'sched-1',
      name: 'daily-review',
      cronExpr: '0 9 * * *',
      agentId: 'agent-1',
      taskTemplate: {
        title: 'Daily PR review',
        description: 'Review all open PRs',
      },
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(schedule.id).toBe('sched-1');
    expect(schedule.cronExpr).toBe('0 9 * * *');
    expect(schedule.enabled).toBe(true);
    expect(schedule.taskTemplate.title).toBe('Daily PR review');
  });

  it('ScheduleInfo supports optional fields', () => {
    const schedule: ScheduleInfo = {
      id: 'sched-2',
      name: 'ci-check',
      cronExpr: '*/30 * * * *',
      agentId: 'agent-2',
      taskTemplate: {
        title: 'CI check',
        description: 'Check CI status',
        files: ['src/'],
        metadata: { priority: 'high' },
      },
      enabled: true,
      createdBy: 'human-1',
      lastRunAt: 1000,
      nextRunAt: 2000,
      createdAt: 500,
      updatedAt: 500,
    };
    expect(schedule.createdBy).toBe('human-1');
    expect(schedule.lastRunAt).toBe(1000);
    expect(schedule.taskTemplate.files).toEqual(['src/']);
  });

  it('ScheduleCreatePayload has required fields', () => {
    const payload: ScheduleCreatePayload = {
      name: 'test-schedule',
      cronExpr: '0 */2 * * *',
      agentId: 'agent-1',
      taskTemplate: {
        title: 'Run tests',
        description: 'Run the full test suite',
      },
    };
    expect(payload.name).toBe('test-schedule');
    expect(payload.cronExpr).toBe('0 */2 * * *');
  });
});
