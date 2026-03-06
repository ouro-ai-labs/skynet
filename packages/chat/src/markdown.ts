import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

const DEFAULT_WIDTH = 80;

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
  return rendered.replace(/\n+$/, '');
}
