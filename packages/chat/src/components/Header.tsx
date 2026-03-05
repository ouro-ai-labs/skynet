import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  roomId: string;
  connected: boolean;
  memberCount: number;
}

export function Header({ roomId, connected, memberCount }: HeaderProps): React.ReactElement {
  return (
    <Box width="100%" height={3} borderStyle="round" borderColor="cyan" justifyContent="space-between" paddingX={1}>
      <Box>
        <Text bold color="cyan">skynet</Text>
        <Text dimColor> · </Text>
        <Text dimColor>#</Text><Text>{roomId}</Text>
        <Text dimColor> · </Text>
        <Text>{memberCount} members</Text>
      </Box>
      <Box>
        {connected ? (
          <Text color="green">● connected</Text>
        ) : (
          <Text color="red">● disconnected</Text>
        )}
      </Box>
    </Box>
  );
}
