/**
 * Parse schedule XML tags from agent response text.
 * Agents output these tags to create, delete, or list schedules.
 */

export interface ScheduleCreateCommand {
  type: 'create';
  name: string;
  cron: string;
  agent: string;
  title: string;
  description: string;
}

export interface ScheduleDeleteCommand {
  type: 'delete';
  id: string;
}

export interface ScheduleListCommand {
  type: 'list';
}

export type ScheduleCommand = ScheduleCreateCommand | ScheduleDeleteCommand | ScheduleListCommand;

const CREATE_PATTERN = /<schedule-create\s+([^>]*?)\/>/g;
const DELETE_PATTERN = /<schedule-delete\s+([^>]*?)\/>/g;
const LIST_PATTERN = /<schedule-list\s*\/>/g;

function parseAttr(tag: string, name: string): string | undefined {
  // Match both single and double quotes
  const pattern = new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`);
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2]) : undefined;
}

export function parseScheduleCommands(text: string): ScheduleCommand[] {
  const commands: ScheduleCommand[] = [];

  for (const match of text.matchAll(CREATE_PATTERN)) {
    const attrs = match[1];
    const name = parseAttr(attrs, 'name');
    const cron = parseAttr(attrs, 'cron');
    const agent = parseAttr(attrs, 'agent');
    const title = parseAttr(attrs, 'title');
    const description = parseAttr(attrs, 'description');

    if (name && cron && agent && title && description) {
      commands.push({
        type: 'create',
        name,
        cron,
        agent: agent.replace(/^@/, ''),
        title,
        description,
      });
    }
  }

  for (const match of text.matchAll(DELETE_PATTERN)) {
    const attrs = match[1];
    const id = parseAttr(attrs, 'id');
    if (id) {
      commands.push({ type: 'delete', id });
    }
  }

  for (const _match of text.matchAll(LIST_PATTERN)) {
    commands.push({ type: 'list' });
  }

  return commands;
}

/** Strip schedule XML tags from text so they don't appear in chat. */
export function stripScheduleTags(text: string): string {
  return text
    .replace(CREATE_PATTERN, '')
    .replace(DELETE_PATTERN, '')
    .replace(LIST_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
