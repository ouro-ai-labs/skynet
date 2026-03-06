import { Command } from 'commander';
import { selectServer, getServerUrl } from '../utils/server-select.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Skynet server and room status')
    .argument('[room-id]', 'Optional room ID for details')
    .option('--server <id>', 'Server UUID or name')
    .action(async (roomId, opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        if (roomId) {
          const [membersRes, messagesRes] = await Promise.all([
            fetch(`${url}/api/rooms/${roomId}/members`),
            fetch(`${url}/api/rooms/${roomId}/messages?limit=10`),
          ]);

          const members = await membersRes.json();
          const messages = await messagesRes.json();

          console.log(`Room: ${roomId}`);
          console.log(`Members (${(members as unknown[]).length}):`);
          for (const m of members as Array<{ name: string; type: string; status: string }>) {
            console.log(`  - ${m.name} (${m.type}) [${m.status}]`);
          }
          console.log(`\nRecent messages (${(messages as unknown[]).length}):`);
          for (const msg of messages as Array<{ from: string; type: string; timestamp: number }>) {
            const time = new Date(msg.timestamp).toLocaleTimeString();
            console.log(`  [${time}] ${msg.from}: ${msg.type}`);
          }
        } else {
          const res = await fetch(`${url}/api/rooms`);
          const rooms = await res.json();

          console.log(`Skynet Server Status: ${workspace.name}`);
          console.log(`Server: ${url}`);
          console.log(`\nRooms (${(rooms as unknown[]).length}):`);
          for (const r of rooms as Array<{ id: string; name: string; memberCount: number }>) {
            console.log(`  - ${r.name} (${r.memberCount} members) [${r.id}]`);
          }
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        console.error('Is the server running? Start it with: skynet server');
        process.exit(1);
      }
    });
}
