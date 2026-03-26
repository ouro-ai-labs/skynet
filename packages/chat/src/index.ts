export { runChatTUI, type ChatTUIOptions } from './tui.js';
export { runChatPipe, type ChatPipeOptions } from './pipe.js';
export type { ChatWeixinOptions } from './weixin.js';
export async function runChatWeixin(
  ...args: Parameters<typeof import('./weixin.js').runChatWeixin>
) {
  const { runChatWeixin: run } = await import('./weixin.js');
  return run(...args);
}
export * from './format.js';
