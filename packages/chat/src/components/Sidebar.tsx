import React from 'react';
import { Box, Text } from 'ink';
import { AgentType, type AgentCard } from '@skynet/protocol';
import { AGENT_LABELS, AGENT_COLORS } from '../format.js';

interface SidebarProps {
  members: Map<string, AgentCard>;
  height: number;
  selfId?: string;
}

export function Sidebar({ members, height, selfId }: SidebarProps): React.ReactElement {
  const sorted = Array.from(members.values()).sort((a, b) => {
    if (a.type === AgentType.HUMAN && b.type !== AgentType.HUMAN) return -1;
    if (a.type !== AgentType.HUMAN && b.type === AgentType.HUMAN) return 1;
    return a.name.localeCompare(b.name);
  });

  const humans = sorted.filter((m) => m.type === AgentType.HUMAN);
  const agents = sorted.filter((m) => m.type !== AgentType.HUMAN);

  return (
    <Box
      flexDirection="column"
      width={26}
      height={height}
      borderStyle="round"
      borderColor="#555555"
      paddingX={1}
    >
      <Text bold color="cyan">Members</Text>
      <Text dimColor>({members.size})</Text>
      {humans.map((m) => renderMember(m, selfId))}
      {humans.length > 0 && agents.length > 0 && (
        <Text dimColor>─────</Text>
      )}
      {agents.map((m) => renderMember(m, selfId))}
    </Box>
  );
}

function renderMember(m: AgentCard, selfId?: string): React.ReactElement {
  const color = AGENT_COLORS[m.type] ?? '#888888';
  const label = AGENT_LABELS[m.type] ?? m.type;
  const isBusy = m.status === 'busy';
  const isSelf = selfId === m.agentId;

  return (
    <Text key={m.agentId}>
      <Text color={isBusy ? 'yellow' : 'green'}>{isBusy ? '◐' : '●'}</Text>{' '}
      <Text color={color} bold>{m.name}</Text>
      <Text dimColor> {label}</Text>
      {isSelf && <Text dimColor> (you)</Text>}
    </Text>
  );
}
