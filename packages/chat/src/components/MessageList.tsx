import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentCard, SkynetMessage } from '@skynet/protocol';
import {
  formatMessage,
  formatSystemMessage,
  createAgentResolver,
} from '../format.js';

interface MessageListProps {
  messages: SkynetMessage[];
  systemMessages: string[];
  members: Map<string, AgentCard>;
  height: number;
  isInputFocused: boolean;
}

interface DisplayLine {
  key: string;
  text: string;
}

export function MessageList({
  messages,
  systemMessages,
  members,
  height,
  isInputFocused,
}: MessageListProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);

  const resolve = createAgentResolver(members);

  // Build display lines
  const lines: DisplayLine[] = [];
  for (const msg of messages) {
    const formatted = formatMessage(msg, resolve);
    for (let i = 0; i < formatted.length; i++) {
      lines.push({ key: `${msg.id}-${i}`, text: formatted[i] });
    }
  }
  for (let i = 0; i < systemMessages.length; i++) {
    lines.push({ key: `sys-${i}`, text: formatSystemMessage(systemMessages[i]) });
  }

  // Viewport height (subtract 2 for border)
  const viewportHeight = Math.max(1, height - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolled) {
      setScrollOffset(maxOffset);
    }
  }, [lines.length, maxOffset, userScrolled]);

  // Keyboard scrolling (only when input is not focused)
  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset((prev) => {
        const step = key.shift ? viewportHeight : 1;
        const next = Math.max(0, prev - step);
        setUserScrolled(true);
        return next;
      });
    } else if (key.downArrow) {
      setScrollOffset((prev) => {
        const step = key.shift ? viewportHeight : 1;
        const next = Math.min(maxOffset, prev + step);
        if (next >= maxOffset) setUserScrolled(false);
        return next;
      });
    } else if (key.pageUp) {
      setScrollOffset((prev) => {
        const next = Math.max(0, prev - viewportHeight);
        setUserScrolled(true);
        return next;
      });
    } else if (key.pageDown) {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + viewportHeight);
        if (next >= maxOffset) setUserScrolled(false);
        return next;
      });
    } else if (input === 'g' && key.shift) {
      setScrollOffset(maxOffset);
      setUserScrolled(false);
    }
  }, { isActive: !isInputFocused });

  const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
  const atBottom = scrollOffset >= maxOffset;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={height}
      borderStyle="round"
      borderColor="#555555"
      paddingX={1}
      overflow="hidden"
    >
      {visible.map((line) => (
        <Text key={line.key} wrap="wrap">{line.text}</Text>
      ))}
      {/* Fill remaining space */}
      {visible.length < viewportHeight && (
        <Box flexGrow={1} />
      )}
      {/* Scroll indicator */}
      {!atBottom && lines.length > viewportHeight && (
        <Text color="cyan">  ↓ more messages below (Shift+G to jump)</Text>
      )}
    </Box>
  );
}
