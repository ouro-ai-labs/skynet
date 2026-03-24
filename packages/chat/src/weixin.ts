import {
  type AgentCard,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type SkynetMessage,
  AgentType,
  MessageType,
} from '@skynet-ai/protocol';
import { SkynetClient, type WorkspaceState } from '@skynet-ai/sdk';
import type { IncomingMessage, WeixinBot as WeixinBotType } from '@pinixai/weixin-bot';
import { createAgentResolver, formatForWeixin, chunkMessage } from './weixin-fmt.js';
import { executeCommand } from './commands.js';

export interface ChatWeixinOptions {
  serverUrl: string;
  name: string;
  id?: string;
}

/**
 * WeChat bridge mode for the chat client.
 * Connects to a Skynet workspace as a human and forwards messages
 * bidirectionally between WeChat and the workspace.
 */
export async function runChatWeixin(opts: ChatWeixinOptions): Promise<void> {
  const { WeixinBot } = await import('@pinixai/weixin-bot');

  const agentId = opts.id ?? `human-weixin-${Date.now()}`;
  const members = new Map<string, AgentCard>();

  // Track the WeChat user we're bridging to (captured from first incoming message)
  let weixinUserId: string | undefined;

  // --- 1. Connect to Skynet workspace ---
  const client = new SkynetClient({
    serverUrl: opts.serverUrl,
    agent: {
      id: agentId,
      name: opts.name,
      type: AgentType.HUMAN,
      capabilities: ['chat'],
      status: 'idle',
    },
    reconnect: true,
  });

  let state: WorkspaceState;
  try {
    state = await client.connect();
  } catch (err) {
    console.error(`Failed to connect to workspace: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  for (const m of state.members) {
    members.set(m.id, m);
  }

  console.log(`Connected to workspace. ${members.size} member(s) online.`);

  // --- 2. Track member changes ---
  client.on('agent-join', (msg: SkynetMessage) => {
    const p = msg.payload as AgentJoinPayload;
    members.set(p.agent.id, p.agent);
  });
  client.on('agent-leave', (msg: SkynetMessage) => {
    const p = msg.payload as AgentLeavePayload;
    members.delete(p.agentId);
  });
  client.on('workspace-state', (ws: WorkspaceState) => {
    members.clear();
    for (const m of ws.members) {
      members.set(m.id, m);
    }
  });

  // --- 3. Login to WeChat ---
  const bot: WeixinBotType = new WeixinBot();
  await bot.login();
  console.log('WeChat bot logged in. Waiting for messages...');

  // --- 4. WeChat → Skynet ---
  bot.onMessage(async (msg: IncomingMessage) => {
    // Capture the WeChat user ID from first message
    if (!weixinUserId) {
      weixinUserId = msg.userId;
    }

    const text = msg.text?.trim();
    if (!text) return;

    // Handle slash commands locally (e.g. /agent list, /watch @name)
    if (text.startsWith('/')) {
      const result = await executeCommand(opts.serverUrl, text, agentId);
      if (result) {
        const reply = result.lines.join('\n');
        if (reply) {
          await bot.reply(msg, reply);
        }
        return;
      }
      // Unknown command — fall through and send as chat
    }

    // Auto-mention: when workspace has exactly 1 agent and 1 human,
    // automatically mention that agent so the user doesn't need to type @name.
    const mentions = getAutoMentions(members, agentId, text);
    client.chat(text, mentions);
  });

  // --- 5. Skynet → WeChat ---
  client.on('message', async (msg: SkynetMessage) => {
    // Skip own messages to avoid echo
    if (msg.from === agentId) return;
    // Skip execution logs
    if (msg.type === MessageType.EXECUTION_LOG) return;
    // Can't send if we don't know the WeChat user yet
    if (!weixinUserId) return;

    const resolve = createAgentResolver(members);
    const formatted = formatForWeixin(msg, resolve);
    if (!formatted) return;

    try {
      const chunks = chunkMessage(formatted);
      for (const chunk of chunks) {
        await bot.send(weixinUserId, chunk);
      }
    } catch (err) {
      console.error(`Failed to send to WeChat: ${err instanceof Error ? err.message : err}`);
    }
  });

  // --- 6. Typing indicators ---
  client.on('status-change', async (data: { agentId: string; status: string }) => {
    if (!weixinUserId) return;
    try {
      if (data.status === 'busy') {
        await bot.sendTyping(weixinUserId);
      } else if (data.status === 'idle') {
        await bot.stopTyping(weixinUserId);
      }
    } catch {
      // Typing indicator failures are non-critical; suppress silently
    }
  });

  // --- 7. Connection events ---
  client.on('disconnected', async () => {
    if (weixinUserId) {
      try {
        await bot.send(weixinUserId, '[Skynet] Disconnected from workspace, reconnecting...');
      } catch {
        // Best-effort notification
      }
    }
  });

  client.on('error', (err: unknown) => {
    console.error(`Skynet error: ${err instanceof Error ? err.message : err}`);
  });

  // --- 8. Start polling and handle shutdown ---
  const shutdown = () => {
    console.log('\nShutting down...');
    bot.stop();
    client.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the WeChat long-polling loop (blocks until bot.stop() is called)
  await bot.run();
}

/**
 * When the workspace has exactly 1 agent and 1 human, return that agent's ID
 * as an auto-mention so the user doesn't need to type @name every time.
 * If the message already contains an explicit @mention, skip auto-mention
 * to avoid overriding user intent.
 */
function getAutoMentions(
  members: Map<string, AgentCard>,
  selfId: string,
  text: string,
): string[] | undefined {
  // If the user already typed an @mention, let the server resolve it naturally
  if (text.includes('@')) return undefined;

  const agents: AgentCard[] = [];
  let humanCount = 0;

  for (const m of members.values()) {
    if (m.type === AgentType.HUMAN) {
      humanCount++;
    } else {
      agents.push(m);
    }
  }

  if (agents.length === 1 && humanCount === 1) {
    return [agents[0].id];
  }

  return undefined;
}
