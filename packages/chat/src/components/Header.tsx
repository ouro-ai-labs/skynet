import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  roomId: string;
  connected: boolean;
  memberCount: number;
}

export function Header({ roomId, connected, memberCount }: HeaderProps): React.ReactElement {
  return (
    <Box width="100%" height={1}>
      <Text bold> skynet</Text>
      <Text dimColor> | </Text>
      <Text>{roomId}</Text>
      <Text dimColor> | </Text>
      {connected ? (
        <Text color="green">connected</Text>
      ) : (
        <Text color="red">disconnected</Text>
      )}
      <Text dimColor> | </Text>
      <Text>{memberCount} members</Text>
    </Box>
  );
}
