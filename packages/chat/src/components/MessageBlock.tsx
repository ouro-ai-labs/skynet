import React from 'react';
import { Box, Text } from 'ink';
import type { AgentCard, SkynetMessage } from '@skynet-ai/protocol';
import {
  formatMessage,
  formatSystemMessage,
  createAgentResolver,
} from '../format.js';

interface MessageBlockProps {
  message: SkynetMessage;
  members: Map<string, AgentCard>;
  width?: number;
}

export function MessageBlock({ message, members, width }: MessageBlockProps): React.ReactElement {
  const resolve = createAgentResolver(members);
  const markdownWidth = width ? Math.max(40, width - 10) : undefined;
  const lines = formatMessage(message, resolve, markdownWidth);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} wrap="wrap">{line}</Text>
      ))}
    </Box>
  );
}

interface SystemMessageBlockProps {
  text: string;
}

export function SystemMessageBlock({ text }: SystemMessageBlockProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">{formatSystemMessage(text)}</Text>
      <Text>{''}</Text>
    </Box>
  );
}
