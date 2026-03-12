import { describe, it, expect } from 'vitest';
import {
  inputReducer,
  initialInputState,
  getMentionContext,
  getCommandContext,
  SLASH_COMMANDS,
  processPaste,
  composePasteMessage,
  type InputState,
} from '../inputState.js';

describe('getMentionContext', () => {
  it('returns null when no @ is present', () => {
    expect(getMentionContext('hello', 5)).toBeNull();
  });

  it('detects @ at cursor position', () => {
    expect(getMentionContext('@', 1)).toEqual({ filter: '', start: 0 });
  });

  it('detects @ with partial name', () => {
    expect(getMentionContext('@ali', 4)).toEqual({ filter: 'ali', start: 0 });
  });

  it('detects @ after space', () => {
    expect(getMentionContext('hello @bo', 9)).toEqual({ filter: 'bo', start: 6 });
  });

  it('returns null when @ is followed by space (completed mention)', () => {
    expect(getMentionContext('@alice ', 7)).toBeNull();
  });

  it('is case-insensitive in filter', () => {
    expect(getMentionContext('@Alice', 6)).toEqual({ filter: 'alice', start: 0 });
  });

  it('returns null when cursor is before @', () => {
    expect(getMentionContext('hello @bob', 3)).toBeNull();
  });
});

describe('inputReducer', () => {
  it('SET_VALUE updates value and cursor, resets historyIndex', () => {
    const state: InputState = { ...initialInputState, historyIndex: 2 };
    const next = inputReducer(state, { type: 'SET_VALUE', value: 'hi', cursorPos: 2 });
    expect(next.value).toBe('hi');
    expect(next.cursorPos).toBe(2);
    expect(next.historyIndex).toBe(-1);
  });

  it('SET_CURSOR only changes cursor position', () => {
    const state: InputState = { ...initialInputState, value: 'hello', cursorPos: 0 };
    const next = inputReducer(state, { type: 'SET_CURSOR', cursorPos: 3 });
    expect(next.cursorPos).toBe(3);
    expect(next.value).toBe('hello');
  });

  it('RESET clears everything', () => {
    const state: InputState = {
      value: 'hello',
      cursorPos: 5,
      historyIndex: 2,
      mentionFilter: 'al',
      mentionStart: 0,
      mentionSelectedIndex: 1,
      commandFilter: null,
      commandSelectedIndex: 0,
    };
    const next = inputReducer(state, { type: 'RESET' });
    expect(next).toEqual(initialInputState);
  });

  it('HISTORY_NAV sets history index, value, and cursor', () => {
    const next = inputReducer(initialInputState, {
      type: 'HISTORY_NAV',
      index: 1,
      value: 'prev msg',
      cursorPos: 8,
    });
    expect(next.historyIndex).toBe(1);
    expect(next.value).toBe('prev msg');
    expect(next.cursorPos).toBe(8);
  });

  it('SET_MENTION updates mention state', () => {
    const next = inputReducer(initialInputState, {
      type: 'SET_MENTION',
      filter: 'al',
      start: 6,
      selectedIndex: 0,
    });
    expect(next.mentionFilter).toBe('al');
    expect(next.mentionStart).toBe(6);
    expect(next.mentionSelectedIndex).toBe(0);
  });

  it('SET_MENTION_SELECTED updates selected index', () => {
    const state: InputState = {
      ...initialInputState,
      mentionFilter: 'a',
      mentionSelectedIndex: 0,
    };
    const next = inputReducer(state, { type: 'SET_MENTION_SELECTED', index: 2 });
    expect(next.mentionSelectedIndex).toBe(2);
  });

  it('SET_COMMAND updates command state', () => {
    const next = inputReducer(initialInputState, {
      type: 'SET_COMMAND',
      filter: 'he',
      selectedIndex: 0,
    });
    expect(next.commandFilter).toBe('he');
    expect(next.commandSelectedIndex).toBe(0);
  });

  it('SET_COMMAND_SELECTED updates command selected index', () => {
    const state: InputState = {
      ...initialInputState,
      commandFilter: 'h',
      commandSelectedIndex: 0,
    };
    const next = inputReducer(state, { type: 'SET_COMMAND_SELECTED', index: 1 });
    expect(next.commandSelectedIndex).toBe(1);
  });
});

describe('getCommandContext', () => {
  it('returns null when input does not start with /', () => {
    expect(getCommandContext('hello', 5)).toBeNull();
  });

  it('returns filter for / at start', () => {
    expect(getCommandContext('/', 1)).toEqual({ filter: '' });
  });

  it('returns filter for partial command', () => {
    expect(getCommandContext('/he', 3)).toEqual({ filter: 'he' });
  });

  it('returns filter for multi-word partial command', () => {
    expect(getCommandContext('/agent ', 7)).toEqual({ filter: 'agent ' });
  });

  it('returns null when exact command is fully typed', () => {
    expect(getCommandContext('/help', 5)).toBeNull();
  });

  it('returns null when exact multi-word command is fully typed', () => {
    expect(getCommandContext('/agent list', 11)).toBeNull();
  });

  it('returns null when input does not match any command', () => {
    expect(getCommandContext('/xyz', 4)).toBeNull();
  });

  it('returns null when input has extra content after a complete command', () => {
    expect(getCommandContext('/help foo', 9)).toBeNull();
  });

  it('shows autocomplete for /agent i (partial interrupt)', () => {
    expect(getCommandContext('/agent i', 8)).toEqual({ filter: 'agent i' });
  });

  it('returns null when /agent interrupt is fully typed', () => {
    expect(getCommandContext('/agent interrupt', 16)).toBeNull();
  });

  it('returns null when /agent interrupt has arg typed', () => {
    expect(getCommandContext('/agent interrupt bob', 19)).toBeNull();
  });

  it('returns null when /agent forget is fully typed', () => {
    expect(getCommandContext('/agent forget', 13)).toBeNull();
  });

  it('shows autocomplete for /agent f (partial forget)', () => {
    expect(getCommandContext('/agent f', 8)).toEqual({ filter: 'agent f' });
  });
});

describe('SLASH_COMMANDS', () => {
  it('includes agent interrupt and forget commands', () => {
    const names = SLASH_COMMANDS.map(c => c.name);
    expect(names).toContain('/agent interrupt');
    expect(names).toContain('/agent forget');
  });
});

describe('processPaste', () => {
  it('returns inline with flattened text for single-line paste', () => {
    const result = processPaste('hello world');
    expect(result).toEqual({ type: 'inline', text: 'hello world' });
  });

  it('returns inline with flattened text for 2-line paste', () => {
    const result = processPaste('line one\nline two');
    expect(result).toEqual({ type: 'inline', text: 'line one line two' });
  });

  it('returns collapse for 3-line paste (threshold)', () => {
    const text = 'line 1\nline 2\nline 3';
    const result = processPaste(text);
    expect(result.type).toBe('collapse');
    if (result.type === 'collapse') {
      expect(result.block.text).toBe(text);
      expect(result.block.lineCount).toBe(3);
    }
  });

  it('returns collapse for many-line paste', () => {
    const text = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj';
    const result = processPaste(text);
    expect(result.type).toBe('collapse');
    if (result.type === 'collapse') {
      expect(result.block.lineCount).toBe(10);
    }
  });

  it('handles \\r\\n line endings', () => {
    const text = 'line 1\r\nline 2\r\nline 3';
    const result = processPaste(text);
    expect(result.type).toBe('collapse');
    if (result.type === 'collapse') {
      expect(result.block.lineCount).toBe(3);
    }
  });

  it('flattens \\r\\n for short pastes', () => {
    const result = processPaste('a\r\nb');
    expect(result).toEqual({ type: 'inline', text: 'a b' });
  });

  it('handles bare \\r line endings (macOS terminal paste)', () => {
    const text = 'line 1\rline 2\rline 3';
    const result = processPaste(text);
    expect(result.type).toBe('collapse');
    if (result.type === 'collapse') {
      expect(result.block.lineCount).toBe(3);
    }
  });

  it('flattens bare \\r for short pastes', () => {
    const result = processPaste('a\rb');
    expect(result).toEqual({ type: 'inline', text: 'a b' });
  });
});

describe('composePasteMessage', () => {
  it('returns typed value when no pasted blocks', () => {
    expect(composePasteMessage([], 'hello')).toBe('hello');
  });

  it('returns pasted block text when no typed value', () => {
    const blocks = [{ text: 'line 1\nline 2\nline 3', lineCount: 3 }];
    expect(composePasteMessage(blocks, '')).toBe('line 1\nline 2\nline 3');
  });

  it('joins pasted blocks and typed value with double newlines', () => {
    const blocks = [{ text: 'block1', lineCount: 1 }];
    expect(composePasteMessage(blocks, 'message')).toBe('block1\n\nmessage');
  });

  it('joins multiple pasted blocks', () => {
    const blocks = [
      { text: 'first\nblock', lineCount: 2 },
      { text: 'second\nblock', lineCount: 2 },
    ];
    expect(composePasteMessage(blocks, 'msg')).toBe('first\nblock\n\nsecond\nblock\n\nmsg');
  });

  it('returns empty string when no blocks and empty typed value', () => {
    expect(composePasteMessage([], '  ')).toBe('');
  });
});
