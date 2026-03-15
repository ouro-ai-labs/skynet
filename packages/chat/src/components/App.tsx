import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { type SkynetMessage, type Attachment } from '@skynet-ai/protocol';
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

function TypingIndicator({ names }: { names: string[] }): React.ReactElement | null {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((prev) => (prev % 3) + 1);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  if (names.length === 0) return null;

  let label: string;
  if (names.length === 1) {
    label = `${names[0]} is thinking`;
  } else if (names.length === 2) {
    label = `${names[0]} and ${names[1]} are thinking`;
  } else {
    label = `${names[0]} and ${names.length - 1} others are thinking`;
  }

  return (
    <Box paddingX={1}>
      <Text dimColor>{label}{'.'.repeat(dots)}</Text>
    </Box>
  );
}

export function App({ options }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { state, sendChat, close, agentId } = useSkynet(options);
  const { columns } = useTerminalSize();
  const [showHelp, setShowHelp] = useState(false);
  const [memberListCounter, setMemberListCounter] = useState(0);
  const [commandOutputs, setCommandOutputs] = useState<Array<{ lines: string[]; error?: boolean }>>([]);

  const handleSubmit = useCallback((text: string, attachments: Attachment[]) => {
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

    // Management commands: /agent, /human, /watch, /unwatch
    if (cmd.startsWith('/agent') || cmd.startsWith('/human') || cmd.startsWith('/watch') || cmd.startsWith('/unwatch')) {
      executeCommand(options.serverUrl, text.trim(), agentId).then((result) => {
        if (result) {
          setCommandOutputs((prev) => [...prev, { lines: result.lines, error: result.error }]);
        }
      });
      return;
    }

    // Server enriches @name mentions from text; no client-side resolution needed
    const atts = attachments.length > 0 ? attachments : undefined;
    sendChat(text, undefined, atts);
  }, [sendChat, close, exit, options.serverUrl, agentId]);

  // Ctrl+D to exit
  useInput((_input, key) => {
    if (key.ctrl && _input === 'd') {
      close().then(() => exit()).catch(() => exit());
    }
  });

  const handleExitHint = useCallback(() => {
    setCommandOutputs((prev) => [
      ...prev,
      { lines: ['Use Ctrl+D or /quit to exit.'] },
    ]);
  }, []);

  // Build static items as an append-only list.
  // Ink's <Static> tracks rendered items by index, so the array must only grow —
  // rebuilding it from scratch causes items at shifted indices to re-render or
  // become invisible.
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  const processedRef = useRef({
    messageCount: 0,
    sysCount: 0,
    memberCounter: 0,
    cmdCount: 0,
  });

  useEffect(() => {
    const p = processedRef.current;
    const newItems: StaticItem[] = [];

    // Append new messages
    for (let i = p.messageCount; i < state.messages.length; i++) {
      const msg = state.messages[i];
      newItems.push({ key: msg.id, type: 'message', message: msg });
    }
    p.messageCount = state.messages.length;

    // Append new system messages
    for (let i = p.sysCount; i < state.systemMessages.length; i++) {
      newItems.push({ key: `sys-${i}`, type: 'system', text: state.systemMessages[i] });
    }
    p.sysCount = state.systemMessages.length;

    // Append member list if newly requested
    if (memberListCounter > p.memberCounter) {
      const lines = formatMemberList(state.members, agentId);
      newItems.push({ key: `members-${memberListCounter}`, type: 'members', memberLines: lines });
      p.memberCounter = memberListCounter;
    }

    // Append new command outputs
    for (let i = p.cmdCount; i < commandOutputs.length; i++) {
      newItems.push({
        key: `cmd-${i}`,
        type: 'command-output',
        commandLines: commandOutputs[i].lines,
        commandError: commandOutputs[i].error,
      });
    }
    p.cmdCount = commandOutputs.length;

    if (newItems.length > 0) {
      setStaticItems((prev) => [...prev, ...newItems]);
    }
  }, [state.messages, state.systemMessages, state.members, agentId, memberListCounter, commandOutputs]);

  const typingNames = useMemo(() => {
    const names: string[] = [];
    for (const [id] of state.busyAgents) {
      const card = state.members.get(id);
      if (card) names.push(card.name);
    }
    return names;
  }, [state.busyAgents, state.members]);

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
        <Text dimColor>Press Ctrl+D to exit</Text>
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

        {/* Typing indicator */}
        <TypingIndicator names={typingNames} />

        {/* Input */}
        <InputBar
          onSubmit={handleSubmit}
          onExitHint={handleExitHint}
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
            <Text>  /agent list          List agents</Text>
            <Text>  /agent interrupt     Interrupt agent</Text>
            <Text>  /agent forget        Reset agent session</Text>
            <Text>  /human list          List humans</Text>
            <Text>  /watch @agent        Watch agent execution</Text>
            <Text>  /unwatch @agent      Stop watching agent</Text>
            <Text />
            <Text bold> Input</Text>
            <Text>  Up/Down         Input history</Text>
            <Text>  @name           Autocomplete member</Text>
            <Text>  Ctrl+V          Paste image from clipboard</Text>
            <Text>  Ctrl+C          Clear input</Text>
            <Text>  Ctrl+D          Exit</Text>
            <Text />
            <Text dimColor>Press /help again to close</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
