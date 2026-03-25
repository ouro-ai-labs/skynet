import { describe, it, expect } from 'vitest';
import { parseScheduleCommands, stripScheduleTags } from '../schedule-parser.js';

describe('parseScheduleCommands', () => {
  it('parses a create command', () => {
    const text = '<schedule-create name="daily-review" cron="0 9 * * *" agent="@backend" title="Daily PR review" description="Review all open PRs" />';
    const cmds = parseScheduleCommands(text);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual({
      type: 'create',
      name: 'daily-review',
      cron: '0 9 * * *',
      agent: 'backend',
      title: 'Daily PR review',
      description: 'Review all open PRs',
    });
  });

  it('parses agent name without @ prefix', () => {
    const text = '<schedule-create name="test" cron="*/5 * * * *" agent="backend" title="Test" description="Test task" />';
    const cmds = parseScheduleCommands(text);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type === 'create' && cmds[0].agent).toBe('backend');
  });

  it('parses a delete command', () => {
    const text = '<schedule-delete id="abc-123" />';
    const cmds = parseScheduleCommands(text);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual({ type: 'delete', id: 'abc-123' });
  });

  it('parses a list command', () => {
    const text = '<schedule-list />';
    const cmds = parseScheduleCommands(text);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual({ type: 'list' });
  });

  it('parses multiple commands in same text', () => {
    const text = `Sure, I'll set that up.

<schedule-create name="ci-check" cron="*/30 * * * *" agent="@dev" title="CI Check" description="Check CI status" />

I'll also delete the old one.

<schedule-delete id="old-123" />`;
    const cmds = parseScheduleCommands(text);
    expect(cmds).toHaveLength(2);
    expect(cmds[0].type).toBe('create');
    expect(cmds[1].type).toBe('delete');
  });

  it('returns empty array for text without schedule commands', () => {
    const text = 'Just a normal message with no schedule commands.';
    expect(parseScheduleCommands(text)).toEqual([]);
  });

  it('ignores incomplete create commands', () => {
    const text = '<schedule-create name="test" cron="0 9 * * *" />';
    expect(parseScheduleCommands(text)).toEqual([]);
  });

  it('handles single-quoted attributes', () => {
    const text = "<schedule-create name='test' cron='0 9 * * *' agent='@pm' title='Test' description='A test' />";
    const cmds = parseScheduleCommands(text);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type === 'create' && cmds[0].name).toBe('test');
  });
});

describe('stripScheduleTags', () => {
  it('strips create tags', () => {
    const text = 'Before\n\n<schedule-create name="test" cron="0 9 * * *" agent="@pm" title="T" description="D" />\n\nAfter';
    expect(stripScheduleTags(text)).toBe('Before\n\nAfter');
  });

  it('strips delete tags', () => {
    const text = 'Done. <schedule-delete id="abc" /> Bye.';
    expect(stripScheduleTags(text)).toBe('Done.  Bye.');
  });

  it('strips list tags', () => {
    const text = 'Here are the schedules:\n\n<schedule-list />';
    expect(stripScheduleTags(text)).toBe('Here are the schedules:');
  });

  it('returns original text if no tags', () => {
    const text = 'Nothing to strip here.';
    expect(stripScheduleTags(text)).toBe('Nothing to strip here.');
  });
});
