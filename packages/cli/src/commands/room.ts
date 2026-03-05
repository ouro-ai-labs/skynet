import { Command } from 'commander';
import { loadConfig } from '../config.js';

export function registerRoomCommand(program: Command): void {
  const config = loadConfig();
  const room = program
    .command('room')
    .description('Manage rooms (create, list, destroy)');

  room
    .command('list')
    .description('List all rooms on the server')
    .option('-s, --server <url>', 'Server URL', config.client.serverUrl)
    .action(async (opts) => {
      try {
        const res = await fetch(`${opts.server}/api/rooms`);
        const rooms = (await res.json()) as Array<{ id: string; memberCount: number }>;

        if (rooms.length === 0) {
          console.log('No rooms.');
          return;
        }

        console.log(`Rooms (${rooms.length}):`);
        for (const r of rooms) {
          console.log(`  - ${r.id} (${r.memberCount} members)`);
        }
      } catch {
        console.error(`Failed to connect to server at ${opts.server}`);
        process.exit(1);
      }
    });

  room
    .command('create')
    .description('Create a new room')
    .argument('<room-id>', 'Room ID to create')
    .option('-s, --server <url>', 'Server URL', config.client.serverUrl)
    .action(async (roomId, opts) => {
      try {
        const res = await fetch(`${opts.server}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId }),
        });

        if (res.status === 201) {
          console.log(`Room '${roomId}' created.`);
        } else if (res.status === 409) {
          console.error(`Room '${roomId}' already exists.`);
          process.exit(1);
        } else {
          const body = (await res.json()) as { error?: string };
          console.error(`Failed to create room: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to server at ${opts.server}`);
        process.exit(1);
      }
    });

  room
    .command('destroy')
    .description('Destroy a room (disconnects all members)')
    .argument('<room-id>', 'Room ID to destroy')
    .option('-s, --server <url>', 'Server URL', config.client.serverUrl)
    .action(async (roomId, opts) => {
      try {
        const res = await fetch(`${opts.server}/api/rooms/${encodeURIComponent(roomId)}`, {
          method: 'DELETE',
        });

        if (res.ok) {
          console.log(`Room '${roomId}' destroyed.`);
        } else if (res.status === 404) {
          console.error(`Room '${roomId}' not found.`);
          process.exit(1);
        } else {
          const body = (await res.json()) as { error?: string };
          console.error(`Failed to destroy room: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to server at ${opts.server}`);
        process.exit(1);
      }
    });
}
