import { Command } from 'commander';
import type { HumanProfile } from '@skynet/protocol';
import { runChatTUI } from '@skynet/chat';
import { selectServer, getServerUrl } from '../utils/server-select.js';

export function registerHumanCommand(program: Command): void {
  const human = program
    .command('human')
    .description('Manage humans')
    .option('--server <id>', 'Server UUID or name')
    .action(async (opts) => {
      // Bare `skynet human`: select server → select human → start chat TUI idle
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      let humans: HumanProfile[];
      try {
        const res = await fetch(`${url}/api/humans`);
        humans = await res.json() as HumanProfile[];
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }

      if (humans.length === 0) {
        console.error('No humans registered. Run \'skynet human new\' to create one.');
        process.exit(1);
      }

      const { default: inquirer } = await import('inquirer');
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select human:',
        choices: humans.map((h) => ({
          name: h.name,
          value: h,
        })),
      }]);

      const humanProfile = selected as HumanProfile;

      // Start chat TUI with a placeholder room (idle state)
      await runChatTUI({
        roomId: '__idle__',
        serverUrl: url,
        name: humanProfile.name,
      });
    });

  human
    .command('new')
    .description('Create a new human')
    .option('--server <id>', 'Server UUID or name')
    .option('--name <name>', 'Human name (skip interactive prompt)')
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
          message: 'Human name:',
          validate: (v: string) => v.trim() ? true : 'Name is required',
        }]);
        name = answers.name;
      }

      try {
        const res = await fetch(`${url}/api/humans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });

        if (res.status === 201) {
          const body = await res.json() as HumanProfile;
          console.log(`Human '${body.name}' created. (ID: ${body.id})`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to create human: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });

  human
    .command('list')
    .description('List all humans')
    .option('--server <id>', 'Server UUID or name')
    .action(async (opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/humans`);
        const humans = await res.json() as HumanProfile[];

        if (humans.length === 0) {
          console.log('No humans.');
          return;
        }

        console.log(`Humans (${humans.length}):`);
        for (const h of humans) {
          console.log(`  - ${h.name} [${h.id}]`);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });

  human
    .command('join')
    .description('Add a human to a room')
    .argument('<human>', 'Human name or UUID')
    .argument('<room>', 'Room name or UUID')
    .option('--server <id>', 'Server UUID or name')
    .action(async (humanId: string, roomId: string, opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/humans/${encodeURIComponent(humanId)}/join/${encodeURIComponent(roomId)}`, {
          method: 'POST',
        });

        if (res.ok) {
          const body = await res.json() as { roomId: string; humanId: string };
          console.log(`Human joined room. (human: ${body.humanId}, room: ${body.roomId})`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });

  human
    .command('leave')
    .description('Remove a human from a room')
    .argument('<human>', 'Human name or UUID')
    .argument('<room>', 'Room name or UUID')
    .option('--server <id>', 'Server UUID or name')
    .action(async (humanId: string, roomId: string, opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/humans/${encodeURIComponent(humanId)}/leave/${encodeURIComponent(roomId)}`, {
          method: 'POST',
        });

        if (res.ok) {
          console.log('Human left room.');
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });
}
