declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  interface MarkedTerminalOptions {
    reflowText?: boolean;
    width?: number;
    tab?: number;
    showSectionPrefix?: boolean;
    unescape?: boolean;
    emoji?: boolean;
  }

  export function markedTerminal(options?: MarkedTerminalOptions): MarkedExtension;
}
