import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal({
  reflowText: true,
  width: 80,
  tab: 2,
}));

/**
 * Render markdown text to chalk-styled terminal string.
 * Returns trimmed output with trailing newlines removed.
 */
export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text);
  if (typeof rendered !== 'string') return text;
  // marked-terminal adds trailing newlines; trim them
  return rendered.replace(/\n+$/, '');
}
