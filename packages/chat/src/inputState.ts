export interface InputState {
  value: string;
  cursorPos: number;
  historyIndex: number;
  mentionFilter: string | null;
  mentionStart: number;
  mentionSelectedIndex: number;
  commandFilter: string | null;
  commandSelectedIndex: number;
}

export type InputAction =
  | { type: 'SET_VALUE'; value: string; cursorPos: number }
  | { type: 'SET_CURSOR'; cursorPos: number }
  | { type: 'RESET' }
  | { type: 'HISTORY_NAV'; index: number; value: string; cursorPos: number }
  | { type: 'SET_MENTION'; filter: string | null; start: number; selectedIndex: number }
  | { type: 'SET_MENTION_SELECTED'; index: number }
  | { type: 'SET_COMMAND'; filter: string | null; selectedIndex: number }
  | { type: 'SET_COMMAND_SELECTED'; index: number };

export const initialInputState: InputState = {
  value: '',
  cursorPos: 0,
  historyIndex: -1,
  mentionFilter: null,
  mentionStart: 0,
  mentionSelectedIndex: 0,
  commandFilter: null,
  commandSelectedIndex: 0,
};

export function inputReducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case 'SET_VALUE':
      return { ...state, value: action.value, cursorPos: action.cursorPos, historyIndex: -1 };
    case 'SET_CURSOR':
      return { ...state, cursorPos: action.cursorPos };
    case 'RESET':
      return { value: '', cursorPos: 0, historyIndex: -1, mentionFilter: null, mentionStart: 0, mentionSelectedIndex: 0, commandFilter: null, commandSelectedIndex: 0 };
    case 'HISTORY_NAV':
      return { ...state, historyIndex: action.index, value: action.value, cursorPos: action.cursorPos };
    case 'SET_MENTION':
      return { ...state, mentionFilter: action.filter, mentionStart: action.start, mentionSelectedIndex: action.selectedIndex };
    case 'SET_MENTION_SELECTED':
      return { ...state, mentionSelectedIndex: action.index };
    case 'SET_COMMAND':
      return { ...state, commandFilter: action.filter, commandSelectedIndex: action.selectedIndex };
    case 'SET_COMMAND_SELECTED':
      return { ...state, commandSelectedIndex: action.index };
    default:
      return state;
  }
}

export interface CommandDef {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: CommandDef[] = [
  { name: '/help', description: 'Toggle help' },
  { name: '/members', description: 'Show members' },
  { name: '/quit', description: 'Leave and exit' },
  { name: '/clear', description: 'Clear screen' },
  { name: '/agent list', description: 'List agents' },
  { name: '/agent interrupt', description: 'Interrupt agent' },
  { name: '/agent forget', description: 'Reset agent session' },
  { name: '/human list', description: 'List humans' },
];

export function getCommandContext(value: string, cursorPos: number): { filter: string } | null {
  const before = value.slice(0, cursorPos);
  // Only trigger when `/` is the first character and no space yet (for simple commands)
  // or partial match on multi-word commands
  if (!before.startsWith('/')) return null;
  // If cursor is past a completed command followed by additional args, don't show autocomplete
  // e.g. "/agent list foo" should not show autocomplete
  const filter = before.slice(1).toLowerCase();
  // Check if any command still matches as a prefix
  const fullInput = '/' + filter;
  const hasMatch = SLASH_COMMANDS.some(
    (cmd) => cmd.name.startsWith(fullInput) || fullInput.startsWith(cmd.name),
  );
  if (!hasMatch) return null;
  // Don't show autocomplete if the input exactly matches a command and has trailing content
  const exactMatch = SLASH_COMMANDS.find((cmd) => cmd.name === fullInput);
  if (exactMatch && cursorPos === value.length) return null;
  // Don't show if there's content after an exact command match
  if (SLASH_COMMANDS.some((cmd) => fullInput.startsWith(cmd.name + ' ') && fullInput.length > cmd.name.length + 1)) return null;
  return { filter };
}

export function getMentionContext(value: string, cursorPos: number): { filter: string; start: number } | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/@(\S*)$/);
  if (!match) return null;
  const start = before.length - match[0].length;
  return { filter: match[1].toLowerCase(), start };
}
