import { Command } from 'commander';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Skynet server and room status')
    .argument('[room-id]', 'Optional room ID for details')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4117')
    .action(async (roomId, opts) => {
      try {
        if (roomId) {
          // Show room details
          const [membersRes, messagesRes] = await Promise.all([
            fetch(`${opts.server}/api/rooms/${roomId}/members`),
            fetch(`${opts.server}/api/rooms/${roomId}/messages?limit=10`),
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
          // Show all rooms
          const res = await fetch(`${opts.server}/api/rooms`);
          const rooms = await res.json();

          console.log('Skynet Server Status');
          console.log(`Server: ${opts.server}`);
          console.log(`\nRooms (${(rooms as unknown[]).length}):`);
          for (const r of rooms as Array<{ id: string; memberCount: number }>) {
            console.log(`  - ${r.id} (${r.memberCount} members)`);
          }
        }
      } catch (err) {
        console.error(`Failed to connect to server at ${opts.server}`);
        console.error('Is the server running? Start it with: skynet server start');
        process.exit(1);
      }
    });
}
