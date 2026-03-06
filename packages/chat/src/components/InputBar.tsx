import React, { useReducer, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentCard } from '@skynet/protocol';
import {
  inputReducer,
  initialInputState,
  getMentionContext,
} from '../inputState.js';

interface InputBarProps {
  onSubmit: (text: string) => void;
  isFocused: boolean;
  onFocusChange: (focused: boolean) => void;
  members: Map<string, AgentCard>;
}

export function InputBar({ onSubmit, isFocused, onFocusChange, members }: InputBarProps): React.ReactElement {
  const [state, dispatch] = useReducer(inputReducer, initialInputState);
  const historyRef = useRef<string[]>([]);

  const { value, cursorPos, mentionFilter, mentionStart, mentionSelectedIndex } = state;

  // Compute mention candidates
  const mentionCandidates = mentionFilter !== null
    ? Array.from(members.values())
        .filter((m) => m.name.toLowerCase().startsWith(mentionFilter))
        .slice(0, 8)
    : [];

  const setValueAndMention = useCallback((newValue: string, newCursorPos: number) => {
    dispatch({ type: 'SET_VALUE', value: newValue, cursorPos: newCursorPos });
    const ctx = getMentionContext(newValue, newCursorPos);
    if (ctx) {
      dispatch({ type: 'SET_MENTION', filter: ctx.filter, start: ctx.start, selectedIndex: 0 });
    } else {
      dispatch({ type: 'SET_MENTION', filter: null, start: 0, selectedIndex: 0 });
    }
  }, []);

  const setCursorAndMention = useCallback((newPos: number) => {
    dispatch({ type: 'SET_CURSOR', cursorPos: newPos });
    const ctx = getMentionContext(value, newPos);
    if (ctx) {
      dispatch({ type: 'SET_MENTION', filter: ctx.filter, start: ctx.start, selectedIndex: 0 });
    } else {
      dispatch({ type: 'SET_MENTION', filter: null, start: 0, selectedIndex: 0 });
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
    setValueAndMention(newValue, newCursor);
  }, [mentionCandidates, mentionSelectedIndex, value, mentionStart, cursorPos, setValueAndMention]);

  useInput((input, key) => {
    if (!isFocused) {
      if (key.return || (input && !key.ctrl && !key.meta)) {
        onFocusChange(true);
        if (input && !key.return) {
          setValueAndMention(input, input.length);
        }
        return;
      }
      return;
    }

    if (key.escape) {
      if (mentionFilter !== null) {
        dispatch({ type: 'SET_MENTION', filter: null, start: 0, selectedIndex: 0 });
        return;
      }
      onFocusChange(false);
      return;
    }

    // Tab: accept mention completion
    if (key.tab && mentionFilter !== null && mentionCandidates.length > 0) {
      acceptMention();
      return;
    }

    if (key.return) {
      if (mentionFilter !== null && mentionCandidates.length > 0) {
        acceptMention();
        return;
      }
      if (value.trim()) {
        historyRef.current.push(value);
        onSubmit(value);
      }
      dispatch({ type: 'RESET' });
      return;
    }

    // Up/Down arrow: mention selection or history
    if (key.upArrow) {
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
        setValueAndMention(newValue, cursorPos - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorAndMention(Math.max(0, cursorPos - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorAndMention(Math.min(value.length, cursorPos + 1));
      return;
    }

    // Ctrl+A: move to start
    if (key.ctrl && input === 'a') {
      setCursorAndMention(0);
      return;
    }

    // Ctrl+E: move to end
    if (key.ctrl && input === 'e') {
      setCursorAndMention(value.length);
      return;
    }

    // Ctrl+U: clear line
    if (key.ctrl && input === 'u') {
      dispatch({ type: 'RESET' });
      return;
    }

    // Ctrl+W: delete word backward
    if (key.ctrl && input === 'w') {
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      const trimmed = before.replace(/\S+\s*$/, '');
      setValueAndMention(trimmed + after, trimmed.length);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && !key.tab) {
      const newValue = value.slice(0, cursorPos) + input + value.slice(cursorPos);
      const newCursor = cursorPos + input.length;
      setValueAndMention(newValue, newCursor);
    }
  });

  // Render the input with a visible cursor
  const before = value.slice(0, cursorPos);
  const cursor = value[cursorPos] ?? ' ';
  const after = value.slice(cursorPos + 1);

  return (
    <Box flexDirection="column">
      {/* Mention autocomplete popup */}
      {isFocused && mentionFilter !== null && mentionCandidates.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginLeft={2}
        >
          {mentionCandidates.map((m, i) => (
            <Text key={m.agentId}>
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
      {/* Input box */}
      <Box
        width="100%"
        height={3}
        borderStyle="round"
        borderColor={isFocused ? 'cyan' : '#444444'}
        paddingX={1}
      >
        {isFocused ? (
          <>
            <Text color="cyan">{'\u276F'} </Text>
            <Text>
              {before}
              <Text inverse color="cyan">{cursor}</Text>
              {after}
            </Text>
          </>
        ) : (
          <Text dimColor>Type a message...  {'\u00B7'}  /help for commands</Text>
        )}
      </Box>
    </Box>
  );
}
