import React from 'react';
import { Box, Text } from 'ink';
import { AgentType, type AgentCard } from '@skynet/protocol';
import { AGENT_LABELS, AGENT_COLORS } from '../format.js';

interface SidebarProps {
  members: Map<string, AgentCard>;
  height: number;
}

export function Sidebar({ members, height }: SidebarProps): React.ReactElement {
  const sorted = Array.from(members.values()).sort((a, b) => {
    if (a.type === AgentType.HUMAN && b.type !== AgentType.HUMAN) return -1;
    if (a.type !== AgentType.HUMAN && b.type === AgentType.HUMAN) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Box
      flexDirection="column"
      width={26}
      height={height}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold> Members ({members.size})</Text>
      {sorted.map((m) => {
        const color = AGENT_COLORS[m.type] ?? '#888888';
        const label = AGENT_LABELS[m.type] ?? m.type;
        const statusColor = m.status === 'busy' ? 'yellow' : 'green';
        return (
          <Box key={m.agentId} flexDirection="column">
            <Text>
              <Text color={statusColor}>*</Text>{' '}
              <Text color={color} bold>{m.name}</Text>
            </Text>
            <Text>   <Text color={color}>{label}</Text></Text>
          </Box>
        );
      })}
    </Box>
  );
}
