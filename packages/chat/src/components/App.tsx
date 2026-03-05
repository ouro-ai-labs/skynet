import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { UseSkynetOptions } from '../hooks/useSkynet.js';
import { useSkynet } from '../hooks/useSkynet.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';
import { MessageList } from './MessageList.js';
import { InputBar } from './InputBar.js';
import { agentNameColored, agentTag } from '../format.js';

interface AppProps {
  options: UseSkynetOptions;
}

export function App({ options }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { state, sendChat, close, agentId } = useSkynet(options);
  const { rows } = useTerminalSize();
  const [inputFocused, setInputFocused] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  // Reserve space: header=3 (with border), input=3, remaining for messages+sidebar
  const contentHeight = Math.max(5, rows - 7);

  const handleSubmit = useCallback((text: string) => {
    // Handle commands
    const cmd = text.toLowerCase().trim();

    if (cmd === '/quit' || cmd === '/exit' || cmd === '/q') {
      close().then(() => exit()).catch(() => exit());
      return;
    }

    if (cmd === '/help' || cmd === '/h') {
      setShowHelp((prev) => !prev);
      return;
    }

    if (cmd === '/members' || cmd === '/m') {
      // Members are visible in the sidebar
      return;
    }

    if (cmd === '/clear' || cmd === '/c') {
      // Cannot clear messages in the current state model.
      // System messages could be cleared but messages come from the hook.
      return;
    }

    // Direct message: @name message
    const dmMatch = text.match(/^@(\S+)\s+(.*)/s);
    if (dmMatch) {
      const targetName = dmMatch[1];
      let targetId: string | null = null;
      for (const [id, card] of state.members) {
        if (card.name.toLowerCase() === targetName.toLowerCase()) {
          targetId = id;
          break;
        }
      }
      if (targetId) {
        sendChat(dmMatch[2], targetId);
      }
      // If not found, silently ignore (user can check sidebar)
      return;
    }

    sendChat(text);
  }, [state.members, sendChat, close, exit]);

  // Ctrl+C to exit
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      close().then(() => exit()).catch(() => exit());
    }
  });

  // Loading state
  if (state.connecting) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text>Connecting to <Text bold color="cyan">{options.roomId}</Text> at {options.serverUrl}...</Text>
      </Box>
    );
  }

  // Error state
  if (state.error && !state.connected) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
        <Text color="red">Failed to connect: {state.error}</Text>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%" height={rows}>
      {/* Header */}
      <Header
        roomId={options.roomId}
        connected={state.connected}
        memberCount={state.members.size}
      />

      {/* Main content area */}
      <Box flexDirection="row" height={contentHeight}>
        {/* Messages */}
        <MessageList
          messages={state.messages}
          systemMessages={state.systemMessages}
          members={state.members}
          height={contentHeight}
          isInputFocused={inputFocused}
        />
        {/* Sidebar */}
        <Sidebar members={state.members} height={contentHeight} selfId={agentId} />
      </Box>

      {/* Input */}
      <InputBar
        onSubmit={handleSubmit}
        isFocused={inputFocused}
        onFocusChange={setInputFocused}
      />

      {/* Help overlay */}
      {showHelp && (
        <Box
          flexDirection="column"
          position="absolute"
          marginTop={2}
          marginLeft={2}
          borderStyle="round"
          borderColor="cyan"
          paddingX={2}
          paddingY={1}
        >
          <Text bold> Commands</Text>
          <Text>  /help, /h       Toggle this help</Text>
          <Text>  /members, /m    (see sidebar)</Text>
          <Text>  /clear, /c      Clear messages</Text>
          <Text>  /quit, /q       Leave and exit</Text>
          <Text>  @name message   Direct message</Text>
          <Text />
          <Text bold> Navigation</Text>
          <Text>  PageUp/Down     Scroll messages</Text>
          <Text>  Shift+G         Jump to bottom</Text>
          <Text>  Escape          Toggle input focus</Text>
          <Text>  Ctrl+C          Exit</Text>
          <Text />
          <Text dimColor>Press /help again to close</Text>
        </Box>
      )}
    </Box>
  );
}
