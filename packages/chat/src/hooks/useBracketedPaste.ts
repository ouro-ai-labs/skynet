import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useStdin } from 'ink';

/**
 * Enable bracketed paste mode on the terminal.
 *
 * When the user pastes text, the terminal wraps it in escape sequences:
 *   \x1b[200~  ... pasted text ...  \x1b[201~
 *
 * This hook detects these sequences and returns the raw pasted text
 * (newlines preserved). The consumer decides how to handle multi-line pastes.
 *
 * A `pasteActiveRef` is exposed so that the consumer can suppress other
 * input handling (e.g. Ink's `useInput`) while a paste is being processed.
 * The ref is set to `true` synchronously in the stdin data handler (which
 * is prepended so it runs before Ink's own handler) and must be set back
 * to `false` by the consumer after the pasted text has been consumed.
 */
export function useBracketedPaste(): {
  pastedText: string | null;
  clearPaste: () => void;
  pasteActiveRef: MutableRefObject<boolean>;
} {
  const { stdin, setRawMode } = useStdin();
  const [pastedText, setPastedText] = useState<string | null>(null);
  const bufferRef = useRef<string>('');
  const pastingRef = useRef(false);
  const pasteActiveRef = useRef(false);

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
        pasteActiveRef.current = true;
        bufferRef.current = '';
        // Capture text after the start sequence
        const afterStart = str.slice(startIdx + 6);
        const endIdx = afterStart.indexOf('\x1b[201~');
        if (endIdx !== -1) {
          // Entire paste fits in one chunk
          bufferRef.current = afterStart.slice(0, endIdx);
          pastingRef.current = false;
          const text = bufferRef.current.trim();
          if (text) {
            setPastedText(text);
          } else {
            pasteActiveRef.current = false;
          }
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
          const text = bufferRef.current.trim();
          if (text) {
            setPastedText(text);
          } else {
            pasteActiveRef.current = false;
          }
          bufferRef.current = '';
        } else {
          bufferRef.current += str;
        }
      }
    };

    // Prepend our listener so it runs BEFORE Ink's own stdin handler.
    // This ensures pasteActiveRef is set before useInput fires.
    stdin.prependListener('data', onData);

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
    pasteActiveRef.current = false;
  };

  return { pastedText, clearPaste, pasteActiveRef };
}
