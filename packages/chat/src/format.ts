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

export function formatMessage(msg: SkynetMessage, resolve: AgentResolver): string[] {
  switch (msg.type) {
    case MessageType.CHAT:
      return [formatChat(msg, resolve)];
    case MessageType.TASK_ASSIGN:
      return [formatTaskAssign(msg, resolve)];
    case MessageType.TASK_UPDATE:
      return [formatTaskUpdate(msg, resolve)];
    case MessageType.TASK_RESULT:
      return [formatTaskResult(msg, resolve)];
    case MessageType.CONTEXT_SHARE:
      return [formatContextShare(msg, resolve)];
    case MessageType.FILE_CHANGE:
      return [formatFileChange(msg, resolve)];
    case MessageType.AGENT_JOIN:
      return [formatJoin(msg)];
    case MessageType.AGENT_LEAVE:
      return [formatLeave(msg, resolve)];
    default:
      return [`${formatTimestamp(msg.timestamp)} ${dimText(`[${msg.type}]`)} ${JSON.stringify(msg.payload)}`];
  }
}

export function formatChat(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as ChatPayload;
  const dm = msg.to
    ? ` ${dimText('->')} ${agentNameColored(resolve(msg.to).name, resolve(msg.to).type)}`
    : '';
  return `${formatTimestamp(msg.timestamp)} ${agentNameColored(s.name, s.type)}${dm}: ${p.text}`;
}

export function formatTaskAssign(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as TaskPayload;
  const to = p.assignee
    ? ` ${chalk.white('->')} ${agentNameColored(resolve(p.assignee).name, resolve(p.assignee).type)}`
    : '';
  return `${formatTimestamp(msg.timestamp)} ${chalk.yellow('[task]')} ${agentNameColored(s.name, s.type)} assigned ${chalk.bold(p.title)}${to}`;
}

export function formatTaskUpdate(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as { taskId: string; status: string };
  return `${formatTimestamp(msg.timestamp)} ${chalk.yellow('[task]')} ${agentNameColored(s.name, s.type)} ${dimText(p.taskId.slice(0, 8))} -> ${chalk.bold(p.status)}`;
}

export function formatTaskResult(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as TaskResultPayload;
  const icon = p.success ? chalk.green('OK') : chalk.red('FAIL');
  return `${formatTimestamp(msg.timestamp)} ${chalk.yellow('[result]')} ${agentNameColored(s.name, s.type)} [${icon}] ${p.summary}`;
}

export function formatContextShare(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as ContextSharePayload;
  return `${formatTimestamp(msg.timestamp)} ${chalk.cyan('[context]')} ${agentNameColored(s.name, s.type)} shared ${p.files?.length ?? 0} file(s)`;
}

export function formatFileChange(msg: SkynetMessage, resolve: AgentResolver): string {
  const p = msg.payload as FileChangePayload;
  const a = resolve(p.agentId);
  const colors: Record<string, (s: string) => string> = {
    created: chalk.green,
    modified: chalk.yellow,
    deleted: chalk.red,
  };
  const colorFn = colors[p.changeType] ?? chalk.white;
  return `${formatTimestamp(msg.timestamp)} ${colorFn(`[${p.changeType}]`)} ${agentNameColored(a.name, a.type)} ${p.path}`;
}

export function formatJoin(msg: SkynetMessage): string {
  const p = msg.payload as AgentJoinPayload;
  return `  ${dimText('--')} ${agentNameColored(p.agent.name, p.agent.type)} ${agentTag(p.agent.type)} joined`;
}

export function formatLeave(msg: SkynetMessage, resolve: AgentResolver): string {
  const p = msg.payload as AgentLeavePayload;
  const a = resolve(p.agentId);
  return `  ${dimText('--')} ${agentNameColored(a.name, a.type)} left`;
}

export function formatSystemMessage(text: string): string {
  return `  ${dimText('--')} ${dimText(text)}`;
}
