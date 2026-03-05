import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputBarProps {
  onSubmit: (text: string) => void;
  isFocused: boolean;
  onFocusChange: (focused: boolean) => void;
}

export function InputBar({ onSubmit, isFocused, onFocusChange }: InputBarProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  useInput((input, key) => {
    if (!isFocused) {
      // Press Enter or any printable key to focus input
      if (key.return || (input && !key.ctrl && !key.meta)) {
        onFocusChange(true);
        if (input && !key.return) {
          setValue(input);
          setCursorPos(input.length);
        }
        return;
      }
      return;
    }

    if (key.escape) {
      onFocusChange(false);
      return;
    }

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
      }
      setValue('');
      setCursorPos(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setValue((prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos((prev) => prev - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPos((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPos((prev) => Math.min(value.length, prev + 1));
      return;
    }

    // Ctrl+A: move to start
    if (key.ctrl && input === 'a') {
      setCursorPos(0);
      return;
    }

    // Ctrl+E: move to end
    if (key.ctrl && input === 'e') {
      setCursorPos(value.length);
      return;
    }

    // Ctrl+U: clear line
    if (key.ctrl && input === 'u') {
      setValue('');
      setCursorPos(0);
      return;
    }

    // Ctrl+W: delete word backward
    if (key.ctrl && input === 'w') {
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      const trimmed = before.replace(/\S+\s*$/, '');
      setValue(trimmed + after);
      setCursorPos(trimmed.length);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev.slice(0, cursorPos) + input + prev.slice(cursorPos));
      setCursorPos((prev) => prev + input.length);
    }
  });

  // Render the input with a visible cursor
  const before = value.slice(0, cursorPos);
  const cursor = value[cursorPos] ?? ' ';
  const after = value.slice(cursorPos + 1);

  return (
    <Box
      width="100%"
      height={3}
      borderStyle="single"
      borderColor={isFocused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Text dimColor>{isFocused ? '> ' : 'Enter message (/help) '}</Text>
      {isFocused && (
        <Text>
          {before}
          <Text inverse>{cursor}</Text>
          {after}
        </Text>
      )}
    </Box>
  );
}
