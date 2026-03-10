import { useEffect, useRef, useState } from 'react';
import { useStdin } from 'ink';

/**
 * Enable bracketed paste mode on the terminal.
 *
 * When the user pastes text, the terminal wraps it in escape sequences:
 *   \x1b[200~  ... pasted text ...  \x1b[201~
 *
 * This hook detects these sequences and returns the pasted text with
 * newlines replaced by spaces (so multi-line pastes become single-line input).
 *
 * Returns:
 *   pastedText — the latest pasted text (null when idle)
 *   clearPaste — call this after consuming the pasted text
 */
export function useBracketedPaste(): { pastedText: string | null; clearPaste: () => void } {
  const { stdin, setRawMode } = useStdin();
  const [pastedText, setPastedText] = useState<string | null>(null);
  const bufferRef = useRef<string>('');
  const pastingRef = useRef(false);

  useEffect(() => {
    if (!stdin) return;

    // Enable bracketed paste mode
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?2004h');
    }

    const onData = (data: Buffer): void => {
      const str = data.toString('utf-8');

      // Check for paste start sequence
      const startIdx = str.indexOf('\x1b[200~');
      if (startIdx !== -1) {
        pastingRef.current = true;
        bufferRef.current = '';
        // Capture text after the start sequence
        const afterStart = str.slice(startIdx + 6);
        const endIdx = afterStart.indexOf('\x1b[201~');
        if (endIdx !== -1) {
          // Entire paste fits in one chunk
          bufferRef.current = afterStart.slice(0, endIdx);
          pastingRef.current = false;
          const text = bufferRef.current.replace(/[\r\n]+/g, ' ').trim();
          if (text) setPastedText(text);
          bufferRef.current = '';
        } else {
          bufferRef.current += afterStart;
        }
        return;
      }

      // Check for paste end sequence while buffering
      if (pastingRef.current) {
        const endIdx = str.indexOf('\x1b[201~');
        if (endIdx !== -1) {
          bufferRef.current += str.slice(0, endIdx);
          pastingRef.current = false;
          const text = bufferRef.current.replace(/[\r\n]+/g, ' ').trim();
          if (text) setPastedText(text);
          bufferRef.current = '';
        } else {
          bufferRef.current += str;
        }
      }
    };

    // Listen on raw stdin before Ink processes it
    stdin.on('data', onData);

    return () => {
      stdin.removeListener('data', onData);
      // Disable bracketed paste mode
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?2004l');
      }
    };
  }, [stdin, setRawMode]);

  const clearPaste = (): void => {
    setPastedText(null);
  };

  return { pastedText, clearPaste };
}
