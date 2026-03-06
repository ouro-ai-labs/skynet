import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
import { applyInlineStyles, renderMarkdown } from '../markdown.js';

// Force chalk to output ANSI codes in test (no TTY)
chalk.level = 3;

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('applyInlineStyles', () => {
  it('converts **bold** to ANSI bold', () => {
    const result = applyInlineStyles('hello **world** there');
    expect(stripAnsi(result)).toBe('hello world there');
    expect(result).toContain('\u001b[1m');
    expect(result).not.toContain('**');
  });

  it('converts *italic* to ANSI italic', () => {
    const result = applyInlineStyles('hello *world* there');
    expect(stripAnsi(result)).toBe('hello world there');
    expect(result).toContain('\u001b[3m');
    expect(result).not.toContain('*');
  });

  it('converts `code` to ANSI yellow', () => {
    const result = applyInlineStyles('use `const x = 1` here');
    expect(stripAnsi(result)).toBe('use const x = 1 here');
    expect(result).toContain('\u001b[33m');
    expect(result).not.toContain('`');
  });

  it('does not treat ** inside bold as italic', () => {
    const result = applyInlineStyles('**bold text** plain');
    expect(stripAnsi(result)).toBe('bold text plain');
    expect(result).not.toContain('**');
  });

  it('handles multiple bold spans', () => {
    const result = applyInlineStyles('**one** and **two**');
    expect(stripAnsi(result)).toBe('one and two');
    expect(result).not.toContain('**');
  });

  it('handles mixed inline styles', () => {
    const result = applyInlineStyles('**bold** and *italic* and `code`');
    const plain = stripAnsi(result);
    expect(plain).toBe('bold and italic and code');
    expect(result).not.toContain('**');
    expect(result).not.toContain('`');
  });

  it('leaves plain text unchanged', () => {
    const result = applyInlineStyles('plain text');
    expect(result).toBe('plain text');
  });

  it('does not match single * adjacent to **', () => {
    const result = applyInlineStyles('**bold**');
    const plain = stripAnsi(result);
    expect(plain).toBe('bold');
  });
});

describe('renderMarkdown', () => {
  it('renders bold in list items', () => {
    const result = renderMarkdown('1. **bold** — description\n2. **item** — more');
    expect(result).not.toContain('**');
    expect(stripAnsi(result)).toContain('bold');
    expect(stripAnsi(result)).toContain('item');
  });

  it('renders italic in list items', () => {
    const result = renderMarkdown('- *italic* item');
    // Should not contain raw *italic* — the asterisks around "italic" should be removed
    expect(stripAnsi(result)).not.toContain('*italic*');
    expect(stripAnsi(result)).toContain('italic');
  });

  it('renders inline code in list items', () => {
    const result = renderMarkdown('- use `code` here');
    expect(result).not.toContain('`');
    expect(stripAnsi(result)).toContain('code');
  });

  it('still renders paragraph bold correctly', () => {
    const result = renderMarkdown('this is **bold** text');
    expect(result).not.toContain('**');
    expect(stripAnsi(result)).toContain('bold');
  });
});
