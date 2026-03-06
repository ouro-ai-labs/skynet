import { describe, it, expect } from 'vitest';
import {
  inputReducer,
  initialInputState,
  getMentionContext,
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
});
