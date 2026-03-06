import chalk from 'chalk';
import {
  AgentType,
  type AgentCard,
  type SkynetMessage,
  type ChatPayload,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type TaskPayload,
  type TaskResultPayload,
  type ContextSharePayload,
  type FileChangePayload,
  MessageType,
} from '@skynet/protocol';
import { renderMarkdown } from './markdown.js';

// ── Color scheme by agent type ──

export const AGENT_COLORS: Record<string, string> = {
  [AgentType.CLAUDE_CODE]: '#b07aff',
  [AgentType.GEMINI_CLI]: '#4285f4',
  [AgentType.CODEX_CLI]: '#10a37f',
  [AgentType.HUMAN]: '#e0e0e0',
  [AgentType.MONITOR]: '#888888',
  [AgentType.GENERIC]: '#d4a574',
};

export const AGENT_LABELS: Record<string, string> = {
  [AgentType.CLAUDE_CODE]: 'Claude',
  [AgentType.GEMINI_CLI]: 'Gemini',
  [AgentType.CODEX_CLI]: 'Codex',
  [AgentType.HUMAN]: 'Human',
  [AgentType.MONITOR]: 'Monitor',
  [AgentType.GENERIC]: 'Agent',
};

export function agentTag(type: AgentType): string {
  const color = AGENT_COLORS[type] ?? '#888888';
  const label = AGENT_LABELS[type] ?? type;
  return chalk.hex(color)(label);
}

export function agentNameColored(name: string, type: AgentType): string {
  const color = AGENT_COLORS[type] ?? '#888888';
  return chalk.hex(color).bold(name);
}

export function dimText(text: string): string {
  return chalk.hex('#666666')(text);
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return dimText(`${h}:${m}`);
}

export type ResolvedAgent = { name: string; type: AgentType };
export type AgentResolver = (agentId: string) => ResolvedAgent;

export function createAgentResolver(members: Map<string, AgentCard>): AgentResolver {
  return (agentId: string) => {
    const card = members.get(agentId);
    if (card) return { name: card.name, type: card.type };
    return { name: agentId.slice(0, 8), type: AgentType.GENERIC };
  };
}

// ── Claude Code style markers ──

const MARKER = '\u23FA'; // ⏺
const CONT = '\u23BF';   // ⎿

function markerColored(type: AgentType): string {
  const color = AGENT_COLORS[type] ?? '#888888';
  return chalk.hex(color)(MARKER);
}

function contColored(type: AgentType): string {
  const color = AGENT_COLORS[type] ?? '#888888';
  return chalk.hex(color)(CONT);
}

const BODY_PREFIX = '  ';
const BODY_CONTINUATION = '     ';

function formatTimestampDim(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return dimText(`(${h}:${m})`);
}

export function formatMessage(msg: SkynetMessage, resolve: AgentResolver, width?: number): string[] {
  switch (msg.type) {
    case MessageType.CHAT:
      return formatChat(msg, resolve, width);
    case MessageType.TASK_ASSIGN:
      return formatTaskAssign(msg, resolve);
    case MessageType.TASK_UPDATE:
      return formatTaskUpdate(msg, resolve);
    case MessageType.TASK_RESULT:
      return formatTaskResult(msg, resolve);
    case MessageType.CONTEXT_SHARE:
      return formatContextShare(msg, resolve);
    case MessageType.FILE_CHANGE:
      return formatFileChange(msg, resolve);
    case MessageType.AGENT_JOIN:
      return formatJoin(msg);
    case MessageType.AGENT_LEAVE:
      return formatLeave(msg, resolve);
    default:
      return [
        `${markerColored(AgentType.GENERIC)} ${dimText(`[${msg.type}]`)} ${formatTimestampDim(msg.timestamp)}`,
        `${BODY_PREFIX}${contColored(AgentType.GENERIC)}  ${JSON.stringify(msg.payload)}`,
        '',
      ];
  }
}

export function formatChat(msg: SkynetMessage, resolve: AgentResolver, width?: number): string[] {
  const s = resolve(msg.from);
  const p = msg.payload as ChatPayload;
  const dm = msg.to
    ? ` ${dimText('->')} ${agentNameColored(resolve(msg.to).name, resolve(msg.to).type)}`
    : '';

  const header = `${markerColored(s.type)} ${agentNameColored(s.name, s.type)}${dm} ${formatTimestampDim(msg.timestamp)}`;

  const rendered = renderMarkdown(p.text, width);
  const bodyLines = rendered.split('\n');
  const lines: string[] = [header];

  for (let i = 0; i < bodyLines.length; i++) {
    if (i === 0) {
      lines.push(`${BODY_PREFIX}${contColored(s.type)}  ${bodyLines[i]}`);
    } else {
      lines.push(`${BODY_CONTINUATION}${bodyLines[i]}`);
    }
  }
  lines.push('');
  return lines;
}

export function formatTaskAssign(msg: SkynetMessage, resolve: AgentResolver): string[] {
  const s = resolve(msg.from);
  const p = msg.payload as TaskPayload;
  const to = p.assignee
    ? ` -> ${agentNameColored(resolve(p.assignee).name, resolve(p.assignee).type)}`
    : '';

  return [
    `${markerColored(s.type)} ${agentNameColored(s.name, s.type)} ${formatTimestampDim(msg.timestamp)}`,
    `${BODY_PREFIX}${contColored(s.type)}  ${chalk.yellow('\u25C6')} task: ${chalk.bold(p.title)}${to}`,
    '',
  ];
}

export function formatTaskUpdate(msg: SkynetMessage, resolve: AgentResolver): string[] {
  const s = resolve(msg.from);
  const p = msg.payload as { taskId: string; status: string };

  return [
    `${markerColored(s.type)} ${agentNameColored(s.name, s.type)} ${formatTimestampDim(msg.timestamp)}`,
    `${BODY_PREFIX}${contColored(s.type)}  ${chalk.yellow('\u25C6')} task ${dimText(p.taskId.slice(0, 8))} -> ${chalk.bold(p.status)}`,
    '',
  ];
}

export function formatTaskResult(msg: SkynetMessage, resolve: AgentResolver): string[] {
  const s = resolve(msg.from);
  const p = msg.payload as TaskResultPayload;
  const icon = p.success ? chalk.green('OK') : chalk.red('FAIL');

  return [
    `${markerColored(s.type)} ${agentNameColored(s.name, s.type)} ${formatTimestampDim(msg.timestamp)}`,
    `${BODY_PREFIX}${contColored(s.type)}  ${chalk.yellow('\u25C6')} result [${icon}] ${p.summary}`,
    '',
  ];
}

export function formatContextShare(msg: SkynetMessage, resolve: AgentResolver): string[] {
  const s = resolve(msg.from);
  const p = msg.payload as ContextSharePayload;

  return [
    `${markerColored(s.type)} ${agentNameColored(s.name, s.type)} ${formatTimestampDim(msg.timestamp)}`,
    `${BODY_PREFIX}${contColored(s.type)}  ${chalk.cyan('\u25C7')} shared ${p.files?.length ?? 0} file(s)`,
    '',
  ];
}

export function formatFileChange(msg: SkynetMessage, resolve: AgentResolver): string[] {
  const p = msg.payload as FileChangePayload;
  const a = resolve(p.agentId);
  const icons: Record<string, string> = {
    created: chalk.green('+'),
    modified: chalk.yellow('~'),
    deleted: chalk.red('-'),
  };
  const icon = icons[p.changeType] ?? chalk.white(p.changeType);

  return [
    `${markerColored(a.type)} ${agentNameColored(a.name, a.type)} ${formatTimestampDim(msg.timestamp)}`,
    `${BODY_PREFIX}${contColored(a.type)}  ${icon} ${p.path}`,
    '',
  ];
}

export function formatJoin(msg: SkynetMessage): string[] {
  const p = msg.payload as AgentJoinPayload;

  return [
    `${markerColored(p.agent.type)} ${dimText('system')}`,
    `${BODY_PREFIX}${contColored(p.agent.type)}  ${agentNameColored(p.agent.name, p.agent.type)} ${agentTag(p.agent.type)} joined`,
    '',
  ];
}

export function formatLeave(msg: SkynetMessage, resolve: AgentResolver): string[] {
  const p = msg.payload as AgentLeavePayload;
  const a = resolve(p.agentId);

  return [
    `${markerColored(a.type)} ${dimText('system')}`,
    `${BODY_PREFIX}${contColored(a.type)}  ${agentNameColored(a.name, a.type)} left`,
    '',
  ];
}

export function formatSystemMessage(text: string): string {
  return `${markerColored(AgentType.MONITOR)} ${dimText('system')}\n${BODY_PREFIX}${contColored(AgentType.MONITOR)}  ${dimText(text)}`;
}

export function formatMemberList(members: Map<string, AgentCard>, selfId?: string): string[] {
  const sorted = Array.from(members.values()).sort((a, b) => {
    if (a.type === AgentType.HUMAN && b.type !== AgentType.HUMAN) return -1;
    if (a.type !== AgentType.HUMAN && b.type === AgentType.HUMAN) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [
    `${markerColored(AgentType.MONITOR)} ${dimText('members')} ${dimText(`(${members.size})`)}`,
  ];

  for (const m of sorted) {
    const isBusy = m.status === 'busy';
    const statusIcon = isBusy ? chalk.yellow('\u25D0') : chalk.green('\u25CF');
    const self = selfId === m.agentId ? dimText(' (you)') : '';
    lines.push(`${BODY_PREFIX}${contColored(m.type)}  ${statusIcon} ${agentNameColored(m.name, m.type)} ${agentTag(m.type)}${self}`);
  }

  lines.push('');
  return lines;
}
