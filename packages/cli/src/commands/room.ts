import { Command } from 'commander';
import { selectServer, getServerUrl } from '../utils/server-select.js';

export function registerRoomCommand(program: Command): void {
  const room = program
    .command('room')
    .description('Manage rooms');

  room
    .command('new')
    .description('Create a new room')
    .option('--server <id>', 'Server UUID or name')
    .option('--name <name>', 'Room name (skip interactive prompt)')
    .action(async (opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      let name: string;
      if (opts.name) {
        name = opts.name;
      } else {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: 'Room name:',
          validate: (v: string) => v.trim() ? true : 'Name is required',
        }]);
        name = answers.name;
      }

      try {
        const res = await fetch(`${url}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });

        if (res.status === 201) {
          const body = await res.json() as { id: string; name: string };
          console.log(`Room '${body.name}' created. (ID: ${body.id})`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to create room: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });

  room
    .command('list')
    .description('List all rooms')
    .option('--server <id>', 'Server UUID or name')
    .action(async (opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/rooms`);
        const rooms = await res.json() as Array<{ id: string; name: string; memberCount: number }>;

        if (rooms.length === 0) {
          console.log('No rooms.');
          return;
        }

        console.log(`Rooms (${rooms.length}):`);
        for (const r of rooms) {
          console.log(`  - ${r.name} (${r.memberCount} members) [${r.id}]`);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });
}
