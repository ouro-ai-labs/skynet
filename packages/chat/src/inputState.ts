export interface InputState {
  value: string;
  cursorPos: number;
  historyIndex: number;
  mentionFilter: string | null;
  mentionStart: number;
  mentionSelectedIndex: number;
}

export type InputAction =
  | { type: 'SET_VALUE'; value: string; cursorPos: number }
  | { type: 'SET_CURSOR'; cursorPos: number }
  | { type: 'RESET' }
  | { type: 'HISTORY_NAV'; index: number; value: string; cursorPos: number }
  | { type: 'SET_MENTION'; filter: string | null; start: number; selectedIndex: number }
  | { type: 'SET_MENTION_SELECTED'; index: number };

export const initialInputState: InputState = {
  value: '',
  cursorPos: 0,
  historyIndex: -1,
  mentionFilter: null,
  mentionStart: 0,
  mentionSelectedIndex: 0,
};

export function inputReducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case 'SET_VALUE':
      return { ...state, value: action.value, cursorPos: action.cursorPos, historyIndex: -1 };
    case 'SET_CURSOR':
      return { ...state, cursorPos: action.cursorPos };
    case 'RESET':
      return { value: '', cursorPos: 0, historyIndex: -1, mentionFilter: null, mentionStart: 0, mentionSelectedIndex: 0 };
    case 'HISTORY_NAV':
      return { ...state, historyIndex: action.index, value: action.value, cursorPos: action.cursorPos };
    case 'SET_MENTION':
      return { ...state, mentionFilter: action.filter, mentionStart: action.start, mentionSelectedIndex: action.selectedIndex };
    case 'SET_MENTION_SELECTED':
      return { ...state, mentionSelectedIndex: action.index };
    default:
      return state;
  }
}

export function getMentionContext(value: string, cursorPos: number): { filter: string; start: number } | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/@(\S*)$/);
  if (!match) return null;
  const start = before.length - match[0].length;
  return { filter: match[1].toLowerCase(), start };
}
