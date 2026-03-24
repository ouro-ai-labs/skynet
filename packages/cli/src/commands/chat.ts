import { Command } from 'commander';
import type { HumanProfile } from '@skynet-ai/protocol';
import { runChatTUI, runChatPipe, runChatWeixin } from '@skynet-ai/chat';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('Start chat TUI as a human participant')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Human name (skip selection prompt)')
    .option('--pipe', 'Non-interactive pipe mode: read from stdin, write to stdout')
    .option('--weixin', 'WeChat bridge mode: forward messages to/from WeChat')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      let humans: HumanProfile[];
      try {
        const res = await fetch(`${url}/api/humans`);
        humans = await res.json() as HumanProfile[];
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
        process.exit(1);
      }

      if (humans.length === 0) {
        console.error('No humans registered. Run \'skynet human new\' to create one.');
        process.exit(1);
      }

      let human: HumanProfile;

      if (opts.name) {
        const found = humans.find((h) => h.name === opts.name);
        if (!found) {
          console.error(`Human '${opts.name}' not found. Available: ${humans.map((h) => h.name).join(', ')}`);
          process.exit(1);
        }
        human = found;
      } else if (humans.length === 1) {
        human = humans[0];
      } else if (opts.pipe || opts.weixin) {
        console.error('Multiple humans found. Use --name to select one in pipe/weixin mode.');
        process.exit(1);
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
        human = selected as HumanProfile;
      }

      if (opts.weixin) {
        await runChatWeixin({ serverUrl: url, name: human.name, id: human.id });
      } else if (opts.pipe) {
        await runChatPipe({ serverUrl: url, name: human.name, id: human.id });
      } else {
        await runChatTUI({ serverUrl: url, name: human.name, id: human.id });
      }
    });
}
