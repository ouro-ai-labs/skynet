import React, { useReducer, useRef, useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentCard, Attachment } from '@skynet-ai/protocol';
import {
  inputReducer,
  initialInputState,
  getMentionContext,
  getCommandContext,
  SLASH_COMMANDS,
} from '../inputState.js';
import { readClipboardImage, formatSize } from '../clipboard.js';

interface InputBarProps {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  members: Map<string, AgentCard>;
}

export function InputBar({ onSubmit, members }: InputBarProps): React.ReactElement {
  const [state, dispatch] = useReducer(inputReducer, initialInputState);
  const historyRef = useRef<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pasteStatus, setPasteStatus] = useState<string | null>(null);
  const pastingRef = useRef(false);

  const { value, cursorPos, mentionFilter, mentionStart, mentionSelectedIndex, commandFilter, commandSelectedIndex } = state;

  const mentionCandidates = mentionFilter !== null
    ? [
        ...('all'.startsWith(mentionFilter) ? [{ id: '__all__', name: 'all' } as AgentCard] : []),
        ...Array.from(members.values())
          .filter((m) => m.name.toLowerCase().startsWith(mentionFilter)),
      ].slice(0, 8)
    : [];

  const commandCandidates = commandFilter !== null
    ? SLASH_COMMANDS.filter((cmd) => cmd.name.slice(1).startsWith(commandFilter))
    : [];

  const setValueAndAutocomplete = useCallback((newValue: string, newCursorPos: number) => {
    dispatch({ type: 'SET_VALUE', value: newValue, cursorPos: newCursorPos });
    const mentionCtx = getMentionContext(newValue, newCursorPos);
    if (mentionCtx) {
      dispatch({ type: 'SET_MENTION', filter: mentionCtx.filter, start: mentionCtx.start, selectedIndex: 0 });
    } else {
      dispatch({ type: 'SET_MENTION', filter: null, start: 0, selectedIndex: 0 });
    }
    const cmdCtx = getCommandContext(newValue, newCursorPos);
    if (cmdCtx) {
      dispatch({ type: 'SET_COMMAND', filter: cmdCtx.filter, selectedIndex: 0 });
    } else {
      dispatch({ type: 'SET_COMMAND', filter: null, selectedIndex: 0 });
    }
  }, []);

  const setCursorAndAutocomplete = useCallback((newPos: number) => {
    dispatch({ type: 'SET_CURSOR', cursorPos: newPos });
    const mentionCtx = getMentionContext(value, newPos);
    if (mentionCtx) {
      dispatch({ type: 'SET_MENTION', filter: mentionCtx.filter, start: mentionCtx.start, selectedIndex: 0 });
    } else {
      dispatch({ type: 'SET_MENTION', filter: null, start: 0, selectedIndex: 0 });
    }
    const cmdCtx = getCommandContext(value, newPos);
    if (cmdCtx) {
      dispatch({ type: 'SET_COMMAND', filter: cmdCtx.filter, selectedIndex: 0 });
    } else {
      dispatch({ type: 'SET_COMMAND', filter: null, selectedIndex: 0 });
    }
  }, [value]);

  const acceptMention = useCallback(() => {
    const selected = mentionCandidates[mentionSelectedIndex];
    if (!selected) return;
    const before = value.slice(0, mentionStart);
    const after = value.slice(cursorPos);
    const completed = `@${selected.name} `;
    const newValue = before + completed + after;
    const newCursor = before.length + completed.length;
    setValueAndAutocomplete(newValue, newCursor);
  }, [mentionCandidates, mentionSelectedIndex, value, mentionStart, cursorPos, setValueAndAutocomplete]);

  const acceptCommand = useCallback(() => {
    const selected = commandCandidates[commandSelectedIndex];
    if (!selected) return;
    const newValue = selected.name;
    const newCursor = newValue.length;
    setValueAndAutocomplete(newValue, newCursor);
  }, [commandCandidates, commandSelectedIndex, setValueAndAutocomplete]);

  const handlePaste = useCallback(async () => {
    if (pastingRef.current) return;
    pastingRef.current = true;
    setPasteStatus('Reading clipboard...');
    try {
      const result = await readClipboardImage();
      if (result) {
        setAttachments((prev) => [...prev, result.attachment]);
        setPasteStatus(null);
      } else {
        setPasteStatus('No image in clipboard');
        setTimeout(() => setPasteStatus(null), 2000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Paste failed';
      setPasteStatus(msg);
      setTimeout(() => setPasteStatus(null), 3000);
    } finally {
      pastingRef.current = false;
    }
  }, []);

  useInput((input, key) => {
    // Ctrl+V: paste image from clipboard
    if (key.ctrl && input === 'v') {
      handlePaste();
      return;
    }

    if (key.escape) {
      // Remove last attachment if any, otherwise dismiss autocomplete
      if (attachments.length > 0) {
        setAttachments((prev) => prev.slice(0, -1));
        return;
      }
      if (mentionFilter !== null) {
        dispatch({ type: 'SET_MENTION', filter: null, start: 0, selectedIndex: 0 });
      }
      if (commandFilter !== null) {
        dispatch({ type: 'SET_COMMAND', filter: null, selectedIndex: 0 });
      }
      return;
    }

    if (key.tab && mentionFilter !== null && mentionCandidates.length > 0) {
      acceptMention();
      return;
    }

    if (key.tab && commandFilter !== null && commandCandidates.length > 0) {
      acceptCommand();
      return;
    }

    if (key.return) {
      if (mentionFilter !== null && mentionCandidates.length > 0) {
        acceptMention();
        return;
      }
      if (commandFilter !== null && commandCandidates.length > 0) {
        acceptCommand();
        return;
      }
      if (value.trim() || attachments.length > 0) {
        historyRef.current.push(value);
        onSubmit(value, attachments);
      }
      dispatch({ type: 'RESET' });
      setAttachments([]);
      return;
    }

    if (key.upArrow) {
      if (commandFilter !== null && commandCandidates.length > 0) {
        dispatch({
          type: 'SET_COMMAND_SELECTED',
          index: (commandSelectedIndex - 1 + commandCandidates.length) % commandCandidates.length,
        });
        return;
      }
      if (mentionFilter !== null && mentionCandidates.length > 0) {
        dispatch({
          type: 'SET_MENTION_SELECTED',
          index: (mentionSelectedIndex - 1 + mentionCandidates.length) % mentionCandidates.length,
        });
        return;
      }
      const history = historyRef.current;
      if (history.length === 0) return;
      const newIndex = state.historyIndex === -1
        ? history.length - 1
        : Math.max(0, state.historyIndex - 1);
      const histVal = history[newIndex] ?? '';
      dispatch({ type: 'HISTORY_NAV', index: newIndex, value: histVal, cursorPos: histVal.length });
      return;
    }

    if (key.downArrow) {
      if (commandFilter !== null && commandCandidates.length > 0) {
        dispatch({
          type: 'SET_COMMAND_SELECTED',
          index: (commandSelectedIndex + 1) % commandCandidates.length,
        });
        return;
      }
      if (mentionFilter !== null && mentionCandidates.length > 0) {
        dispatch({
          type: 'SET_MENTION_SELECTED',
          index: (mentionSelectedIndex + 1) % mentionCandidates.length,
        });
        return;
      }
      if (state.historyIndex === -1) return;
      const newIndex = state.historyIndex + 1;
      const history = historyRef.current;
      if (newIndex >= history.length) {
        dispatch({ type: 'HISTORY_NAV', index: -1, value: '', cursorPos: 0 });
      } else {
        const histVal = history[newIndex] ?? '';
        dispatch({ type: 'HISTORY_NAV', index: newIndex, value: histVal, cursorPos: histVal.length });
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
        setValueAndAutocomplete(newValue, cursorPos - 1);
      } else if (value.length === 0 && attachments.length > 0) {
        // Backspace on empty input removes last attachment
        setAttachments((prev) => prev.slice(0, -1));
      }
      return;
    }

    if (key.leftArrow) {
      setCursorAndAutocomplete(Math.max(0, cursorPos - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorAndAutocomplete(Math.min(value.length, cursorPos + 1));
      return;
    }

    if (key.ctrl && input === 'a') {
      setCursorAndAutocomplete(0);
      return;
    }

    if (key.ctrl && input === 'e') {
      setCursorAndAutocomplete(value.length);
      return;
    }

    if (key.ctrl && input === 'u') {
      dispatch({ type: 'RESET' });
      setAttachments([]);
      return;
    }

    if (key.ctrl && input === 'w') {
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      const trimmed = before.replace(/\S+\s*$/, '');
      setValueAndAutocomplete(trimmed + after, trimmed.length);
      return;
    }

    if (input && !key.ctrl && !key.meta && !key.tab) {
      const newValue = value.slice(0, cursorPos) + input + value.slice(cursorPos);
      const newCursor = cursorPos + input.length;
      setValueAndAutocomplete(newValue, newCursor);
    }
  });

  const before = value.slice(0, cursorPos);
  const cursor = value[cursorPos] ?? ' ';
  const after = value.slice(cursorPos + 1);

  return (
    <Box flexDirection="column">
      {commandFilter !== null && commandCandidates.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginLeft={2}
        >
          {commandCandidates.map((cmd, i) => (
            <Text key={cmd.name}>
              {i === commandSelectedIndex ? (
                <Text color="yellow" bold>{`> ${cmd.name}`}</Text>
              ) : (
                <Text dimColor>{`  ${cmd.name}`}</Text>
              )}
              <Text dimColor>{`  ${cmd.description}`}</Text>
            </Text>
          ))}
          <Text dimColor>Tab/Enter to select, Esc to dismiss</Text>
        </Box>
      )}
      {mentionFilter !== null && mentionCandidates.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginLeft={2}
        >
          {mentionCandidates.map((m, i) => (
            <Text key={m.id}>
              {i === mentionSelectedIndex ? (
                <Text color="cyan" bold>{`> ${m.name}`}</Text>
              ) : (
                <Text dimColor>{`  ${m.name}`}</Text>
              )}
            </Text>
          ))}
          <Text dimColor>Tab/Enter to select, Esc to dismiss</Text>
        </Box>
      )}
      {/* Attachment indicators */}
      {attachments.length > 0 && (
        <Box paddingX={1} gap={1}>
          {attachments.map((att, i) => (
            <Text key={i} color="magenta">
              [{att.name} {formatSize(att.size)}]
            </Text>
          ))}
          <Text dimColor>Esc to remove</Text>
        </Box>
      )}
      {/* Paste status message */}
      {pasteStatus && (
        <Box paddingX={1}>
          <Text color="yellow">{pasteStatus}</Text>
        </Box>
      )}
      <Box paddingX={1}>
        <Text color="cyan">{'\u276F'} </Text>
        <Text>
          {before}
          <Text inverse color="cyan">{cursor}</Text>
          {after}
        </Text>
      </Box>
    </Box>
  );
}
