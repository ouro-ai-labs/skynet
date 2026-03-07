import { Command } from 'commander';
import type { HumanProfile } from '@skynet/protocol';
import { runChatTUI } from '@skynet/chat';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('Start chat TUI as a human participant')
    .option('--workspace <id>', 'Workspace UUID')
    .option('--name <name>', 'Human name (skip selection prompt)')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      let name: string;

      if (opts.name) {
        name = opts.name;
      } else {
        let humans: HumanProfile[];
        try {
          const res = await fetch(`${url}/api/humans`);
          humans = await res.json() as HumanProfile[];
        } catch {
          console.error(`Failed to connect to workspace at ${url}`);
          process.exit(1);
        }

        if (humans.length === 0) {
          console.error('No humans registered. Run \'skynet human new\' to create one.');
          process.exit(1);
        }

        if (humans.length === 1) {
          name = humans[0].name;
        } else {
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
          name = (selected as HumanProfile).name;
        }
      }

      await runChatTUI({ serverUrl: url, name });
    });
}
