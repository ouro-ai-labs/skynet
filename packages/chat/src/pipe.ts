import { createInterface } from 'node:readline';
import chalk from 'chalk';
import {
  type AgentCard,
  type AgentJoinPayload,
  type AgentLeavePayload,
  type SkynetMessage,
  AgentType,
  MessageType,
} from '@skynet-ai/protocol';
import { SkynetClient, type WorkspaceState } from '@skynet-ai/sdk';
import { formatMessage, createAgentResolver } from './format.js';
import { executeCommand } from './commands.js';

export interface ChatPipeOptions {
  serverUrl: string;
  name: string;
  id?: string;
}

/**
 * Non-interactive pipe mode for the chat client.
 * Reads messages from stdin (one per line), writes received messages to stdout as plain text.
 * Designed for scripting, testing, and automation.
 */
export async function runChatPipe(opts: ChatPipeOptions): Promise<void> {
  // Disable ANSI colors for clean piped output
  chalk.level = 0;

  const agentId = opts.id ?? `human-pipe-${Date.now()}`;
  const members = new Map<string, AgentCard>();

  const client = new SkynetClient({
    serverUrl: opts.serverUrl,
    agent: {
      id: agentId,
      name: opts.name,
      type: AgentType.HUMAN,
      capabilities: ['chat'],
      status: 'idle',
    },
    reconnect: false, // No reconnection in pipe mode
  });

  // Connect and populate member map
  let state: WorkspaceState;
  try {
    state = await client.connect();
  } catch (err) {
    process.stderr.write(`Failed to connect: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  for (const m of state.members) {
    members.set(m.id, m);
  }

  // Print recent messages
  for (const msg of state.recentMessages) {
    if (msg.type === MessageType.EXECUTION_LOG) continue;
    printMessage(msg, members);
  }

  // Track member changes
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

  // Print incoming messages
  client.on('message', (msg: SkynetMessage) => {
    if (msg.type === MessageType.EXECUTION_LOG) return;
    printMessage(msg, members);
  });

  client.on('disconnected', () => {
    process.stderr.write('Disconnected from workspace.\n');
    process.exit(1);
  });

  client.on('error', (err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : err}\n`);
  });

  // Read stdin lines as messages
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;

    // Handle slash commands (e.g. /agent list, /watch @agent, /unwatch @agent)
    if (text.startsWith('/')) {
      const result = await executeCommand(opts.serverUrl, text, agentId);
      if (result) {
        const prefix = result.error ? '[ERROR] ' : '';
        for (const l of result.lines) {
          process.stdout.write(`${prefix}${l}\n`);
        }
        continue;
      }
      // Unknown command — fall through and send as chat
    }

    // Server enriches @name mentions from text; no client-side resolution needed
    client.chat(text);
  }

  // stdin EOF — clean up
  await client.close();
}

function printMessage(msg: SkynetMessage, members: Map<string, AgentCard>): void {
  const resolve = createAgentResolver(members);
  const lines = formatMessage(msg, resolve);
  for (const line of lines) {
    if (line) process.stdout.write(line + '\n');
  }
}
