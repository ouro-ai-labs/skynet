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
  return `{${color}-fg}${label}{/${color}-fg}`;
}

export function agentNameColored(name: string, type: AgentType): string {
  const color = AGENT_COLORS[type] ?? '#888888';
  return `{${color}-fg}{bold}${name}{/bold}{/${color}-fg}`;
}

export function dimText(text: string): string {
  return `{#666666-fg}${text}{/#666666-fg}`;
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return dimText(`${h}:${m}`);
}

export function escapeMarkup(text: string): string {
  // Replace both braces simultaneously to avoid double-escaping
  return text.replace(/[{}]/g, (ch) => (ch === '{' ? '{open}' : '{close}'));
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
      return [`${formatTimestamp(msg.timestamp)} ${dimText(`[${msg.type}]`)} ${escapeMarkup(JSON.stringify(msg.payload))}`];
  }
}

export function formatChat(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as ChatPayload;
  const dm = msg.to
    ? ` ${dimText('->')} ${agentNameColored(resolve(msg.to).name, resolve(msg.to).type)}`
    : '';
  return `${formatTimestamp(msg.timestamp)} ${agentNameColored(s.name, s.type)}${dm}: ${escapeMarkup(p.text)}`;
}

export function formatTaskAssign(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as TaskPayload;
  const to = p.assignee
    ? ` {white-fg}->{/white-fg} ${agentNameColored(resolve(p.assignee).name, resolve(p.assignee).type)}`
    : '';
  return `${formatTimestamp(msg.timestamp)} {yellow-fg}[task]{/yellow-fg} ${agentNameColored(s.name, s.type)} assigned {bold}${escapeMarkup(p.title)}{/bold}${to}`;
}

export function formatTaskUpdate(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as { taskId: string; status: string };
  return `${formatTimestamp(msg.timestamp)} {yellow-fg}[task]{/yellow-fg} ${agentNameColored(s.name, s.type)} ${dimText(p.taskId.slice(0, 8))} -> {bold}${escapeMarkup(p.status)}{/bold}`;
}

export function formatTaskResult(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as TaskResultPayload;
  const icon = p.success ? '{green-fg}OK{/green-fg}' : '{red-fg}FAIL{/red-fg}';
  return `${formatTimestamp(msg.timestamp)} {yellow-fg}[result]{/yellow-fg} ${agentNameColored(s.name, s.type)} [${icon}] ${escapeMarkup(p.summary)}`;
}

export function formatContextShare(msg: SkynetMessage, resolve: AgentResolver): string {
  const s = resolve(msg.from);
  const p = msg.payload as ContextSharePayload;
  return `${formatTimestamp(msg.timestamp)} {cyan-fg}[context]{/cyan-fg} ${agentNameColored(s.name, s.type)} shared ${p.files?.length ?? 0} file(s)`;
}

export function formatFileChange(msg: SkynetMessage, resolve: AgentResolver): string {
  const p = msg.payload as FileChangePayload;
  const a = resolve(p.agentId);
  const colors: Record<string, string> = { created: 'green', modified: 'yellow', deleted: 'red' };
  const c = colors[p.changeType] ?? 'white';
  return `${formatTimestamp(msg.timestamp)} {${c}-fg}[${p.changeType}]{/${c}-fg} ${agentNameColored(a.name, a.type)} ${escapeMarkup(p.path)}`;
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
