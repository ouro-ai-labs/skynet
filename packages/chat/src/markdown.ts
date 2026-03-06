import chalk from 'chalk';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

const DEFAULT_WIDTH = 80;

/**
 * marked-terminal does not process inline markdown (bold, italic, code)
 * inside list items. This post-processes the output to apply ANSI styling
 * for any remaining raw markdown syntax.
 */
export function applyInlineStyles(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_m, content: string) => chalk.bold(content))
    .replace(/(?<!\*)\*(?!\s|\*)(.+?)(?<!\s|\*)\*(?!\*)/g, (_m, content: string) => chalk.italic(content))
    .replace(/`([^`]+)`/g, (_m, content: string) => chalk.yellow(content));
}

export function renderMarkdown(text: string, width?: number): string {
  const effectiveWidth = width ?? DEFAULT_WIDTH;

  const instance = new Marked();
  instance.use(markedTerminal({
    reflowText: true,
    width: effectiveWidth,
    tab: 2,
  }));

  const rendered = instance.parse(text);
  if (typeof rendered !== 'string') return text;
  const trimmed = rendered.replace(/\n+$/, '');
  return applyInlineStyles(trimmed);
}
