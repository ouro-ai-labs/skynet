import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { AgentType, type SkynetMessage, MessageType } from '@skynet/protocol';
import { SkynetClient } from '@skynet/sdk';

export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('Join a room as a human and chat with agents')
    .argument('<room-id>', 'Room ID to join')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4117')
    .option('-n, --name <name>', 'Your display name', `human-${randomUUID().slice(0, 6)}`)
    .action(async (roomId, opts) => {
      const client = new SkynetClient({
        serverUrl: opts.server,
        agent: {
          agentId: randomUUID(),
          name: opts.name,
          type: AgentType.HUMAN,
          capabilities: ['chat', 'review'],
          status: 'idle',
        },
        roomId,
      });

      const state = await client.connect();
      console.log(`Joined room "${roomId}" as "${opts.name}"`);
      console.log(`Members: ${state.members.map((m) => `${m.name} (${m.type})`).join(', ')}`);
      console.log('---');
      console.log('Type messages to send. Use @name to DM. /quit to exit.');
      console.log('');

      // Show recent messages
      for (const msg of state.recentMessages) {
        printMessage(msg);
      }

      // Listen for incoming messages
      client.on('message', (msg: SkynetMessage) => {
        if (msg.from !== client.agent.agentId) {
          printMessage(msg);
        }
      });

      client.on('agent-join', (msg: SkynetMessage) => {
        const payload = msg.payload as { agent: { name: string; type: string } };
        console.log(`  >> ${payload.agent.name} (${payload.agent.type}) joined`);
      });

      client.on('agent-leave', (msg: SkynetMessage) => {
        const payload = msg.payload as { agentId: string };
        console.log(`  >> ${payload.agentId} left`);
      });

      // Read input
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.setPrompt(`${opts.name}> `);
      rl.prompt();

      rl.on('line', (line) => {
        const text = line.trim();
        if (!text) {
          rl.prompt();
          return;
        }

        if (text === '/quit' || text === '/exit') {
          rl.close();
          return;
        }

        if (text === '/members') {
          // Refresh handled via server state - for now just note it
          console.log('  (use /quit to exit)');
          rl.prompt();
          return;
        }

        // Check for @mention DM
        const dmMatch = text.match(/^@(\S+)\s+(.*)/s);
        if (dmMatch) {
          // This is a simplified DM - in practice we'd resolve name to agentId
          client.chat(dmMatch[2], dmMatch[1]);
        } else {
          client.chat(text);
        }

        rl.prompt();
      });

      rl.on('close', async () => {
        console.log('\nLeaving room...');
        await client.close();
        process.exit(0);
      });
    });
}

function printMessage(msg: SkynetMessage): void {
  const time = new Date(msg.timestamp).toLocaleTimeString();
  switch (msg.type) {
    case MessageType.CHAT: {
      const payload = msg.payload as { text: string };
      const dm = msg.to ? ` (DM to ${msg.to})` : '';
      console.log(`[${time}] ${msg.from}${dm}: ${payload.text}`);
      break;
    }
    case MessageType.TASK_ASSIGN: {
      const payload = msg.payload as { title: string; assignee?: string };
      console.log(`[${time}] ${msg.from} assigned task: ${payload.title}${payload.assignee ? ` -> ${payload.assignee}` : ''}`);
      break;
    }
    case MessageType.TASK_RESULT: {
      const payload = msg.payload as { taskId: string; success: boolean; summary: string };
      const icon = payload.success ? 'OK' : 'FAIL';
      console.log(`[${time}] ${msg.from} task result [${icon}]: ${payload.summary}`);
      break;
    }
    default:
      console.log(`[${time}] ${msg.from} [${msg.type}]: ${JSON.stringify(msg.payload)}`);
  }
}
