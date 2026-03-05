import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { runChatTUI } from '@skynet/chat';

export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('Join a room as a human and chat with agents')
    .argument('<room-id>', 'Room ID to join')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4117')
    .option('-n, --name <name>', 'Your display name', `human-${randomUUID().slice(0, 6)}`)
    .action(async (roomId: string, opts: { server: string; name: string }) => {
      await runChatTUI({ roomId, serverUrl: opts.server, name: opts.name });
    });
}
