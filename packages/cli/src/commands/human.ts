import { Command } from 'commander';
import type { HumanProfile } from '@skynet/protocol';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

export function registerHumanCommand(program: Command): void {
  const human = program
    .command('human')
    .description('Manage humans')
    .enablePositionalOptions()
    .passThroughOptions();

  human
    .command('new')
    .description('Create a new human')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Human name (skip interactive prompt)')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
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
        console.error(`Failed to connect to workspace at ${url}`);
        process.exit(1);
      }
    });

  human
    .command('delete <id>')
    .description('Delete a human by UUID')
    .option('--workspace <id>', 'Workspace UUID')
    .option('--force', 'Skip confirmation prompt')
    .action(async (humanId: string, opts: { workspace?: string; force?: boolean }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        // Fetch human profile for confirmation message
        const getRes = await fetch(`${url}/api/humans/${humanId}`);
        if (getRes.status === 404) {
          console.error(`Human '${humanId}' not found. Run 'skynet human list' to see available humans.`);
          process.exit(1);
        }
        const human = await getRes.json() as HumanProfile;

        if (!opts.force) {
          const { default: inquirer } = await import('inquirer');
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Delete human '${human.name}' (${human.id})?`,
            default: false,
          }]);
          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        const res = await fetch(`${url}/api/humans/${human.id}`, { method: 'DELETE' });

        if (res.status === 200) {
          console.log(`Human '${human.name}' deleted.`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to delete human: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        process.exit(1);
      }
    });

  human
    .command('list')
    .description('List all humans')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
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
        console.error(`Failed to connect to workspace at ${url}`);
        process.exit(1);
      }
    });
}
