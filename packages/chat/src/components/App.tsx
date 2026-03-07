import React, { useState, useCallback, useMemo } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { type SkynetMessage, extractMentionNames, MENTION_ALL } from '@skynet/protocol';
import type { UseSkynetOptions } from '../hooks/useSkynet.js';
import { useSkynet } from '../hooks/useSkynet.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { MessageBlock, SystemMessageBlock } from './MessageBlock.js';
import { InputBar } from './InputBar.js';
import { formatMemberList } from '../format.js';
import { executeCommand } from '../commands.js';

interface AppProps {
  options: UseSkynetOptions;
}

interface StaticItem {
  key: string;
  type: 'message' | 'system' | 'members' | 'command-output';
  message?: SkynetMessage;
  text?: string;
  memberLines?: string[];
  commandLines?: string[];
  commandError?: boolean;
}

export function App({ options }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { state, sendChat, close, agentId } = useSkynet(options);
  const { columns } = useTerminalSize();
  const [showHelp, setShowHelp] = useState(false);
  const [memberListCounter, setMemberListCounter] = useState(0);
  const [commandOutputs, setCommandOutputs] = useState<Array<{ lines: string[]; error?: boolean }>>([]);

  const handleSubmit = useCallback((text: string) => {
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
      setMemberListCounter((prev) => prev + 1);
      return;
    }

    if (cmd === '/clear' || cmd === '/c') {
      return;
    }

    // Management commands: /agent, /human
    if (cmd.startsWith('/agent') || cmd.startsWith('/human')) {
      executeCommand(options.serverUrl, text.trim()).then((result) => {
        if (result) {
          setCommandOutputs((prev) => [...prev, { lines: result.lines, error: result.error }]);
        }
      });
      return;
    }

    // Resolve @name tokens to agent IDs
    const mentionedNames = extractMentionNames(text);
    const resolvedIds: string[] = [];
    for (const name of mentionedNames) {
      if (name === 'all') {
        resolvedIds.push(MENTION_ALL);
        continue;
      }
      for (const [id, card] of state.members) {
        if (card.name.toLowerCase() === name) {
          resolvedIds.push(id);
          break;
        }
      }
    }

    if (resolvedIds.length > 0) {
      sendChat(text, resolvedIds);
    } else {
      sendChat(text);
    }
  }, [state.members, sendChat, close, exit]);

  // Ctrl+C to exit
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      close().then(() => exit()).catch(() => exit());
    }
  });

  // Build static items list
  const staticItems = useMemo((): StaticItem[] => {
    const items: StaticItem[] = [];

    for (const msg of state.messages) {
      items.push({ key: msg.id, type: 'message', message: msg });
    }

    for (let i = 0; i < state.systemMessages.length; i++) {
      items.push({ key: `sys-${i}`, type: 'system', text: state.systemMessages[i] });
    }

    if (memberListCounter > 0) {
      const lines = formatMemberList(state.members, agentId);
      items.push({ key: `members-${memberListCounter}`, type: 'members', memberLines: lines });
    }

    for (let i = 0; i < commandOutputs.length; i++) {
      items.push({
        key: `cmd-${i}`,
        type: 'command-output',
        commandLines: commandOutputs[i].lines,
        commandError: commandOutputs[i].error,
      });
    }

    return items;
  }, [state.messages, state.systemMessages, state.members, agentId, memberListCounter, commandOutputs]);

  // Loading state
  if (state.connecting) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text>Connecting to workspace at {options.serverUrl}...</Text>
      </Box>
    );
  }

  // Error state
  if (state.error && !state.connected) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="red">Failed to connect: {state.error}</Text>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  const statusLine = `${state.connected ? '\u25CF' : '\u25CB'} workspace \u00B7 ${state.members.size} members`;

  return (
    <>
      <Static items={staticItems}>
        {(item) => {
          if (item.type === 'message' && item.message) {
            return (
              <Box key={item.key}>
                <MessageBlock
                  message={item.message}
                  members={state.members}
                  width={columns}
                />
              </Box>
            );
          }
          if (item.type === 'system' && item.text) {
            return (
              <Box key={item.key}>
                <SystemMessageBlock text={item.text} />
              </Box>
            );
          }
          if (item.type === 'members' && item.memberLines) {
            return (
              <Box key={item.key} flexDirection="column">
                {item.memberLines.map((line, i) => (
                  <Text key={i} wrap="wrap">{line}</Text>
                ))}
              </Box>
            );
          }
          if (item.type === 'command-output' && item.commandLines) {
            return (
              <Box key={item.key} flexDirection="column">
                {item.commandLines.map((line, i) => (
                  <Text key={i} color={item.commandError ? 'red' : 'yellow'} wrap="wrap">{line}</Text>
                ))}
              </Box>
            );
          }
          return <Box key={item.key} />;
        }}
      </Static>

      {/* Dynamic bottom area */}
      <Box flexDirection="column">
        {/* Status line */}
        <Box paddingX={1}>
          <Text dimColor>{statusLine}</Text>
        </Box>

        {/* Input */}
        <InputBar
          onSubmit={handleSubmit}
          members={state.members}
        />

        {/* Help overlay */}
        {showHelp && (
          <Box
            flexDirection="column"
            paddingX={2}
            paddingY={1}
            borderStyle="round"
            borderColor="cyan"
          >
            <Text bold> Commands</Text>
            <Text>  /help, /h       Toggle this help</Text>
            <Text>  /members, /m    Show members</Text>
            <Text>  /quit, /q       Leave and exit</Text>
            <Text>  @name message   Direct message</Text>
            <Text />
            <Text bold> Management</Text>
            <Text>  /agent list     List agents</Text>
            <Text>  /human list     List humans</Text>
            <Text />
            <Text bold> Input</Text>
            <Text>  Up/Down         Input history</Text>
            <Text>  @name           Autocomplete member</Text>
            <Text>  Ctrl+C          Exit</Text>
            <Text />
            <Text dimColor>Press /help again to close</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
