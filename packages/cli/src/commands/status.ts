import { Command } from 'commander';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Skynet workspace status')
    .option('--workspace <id>', 'Workspace UUID')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        const [membersRes, agentsRes, humansRes] = await Promise.all([
          fetch(`${url}/api/members`),
          fetch(`${url}/api/agents`),
          fetch(`${url}/api/humans`),
        ]);

        const members = await membersRes.json() as Array<{ name: string; type: string; status?: string }>;
        const agents = await agentsRes.json() as Array<{ id: string; name: string; type: string }>;
        const humans = await humansRes.json() as Array<{ id: string; name: string }>;

        console.log(`Skynet Workspace: ${workspace.name}`);
        console.log(`Server: ${url}`);
        console.log(`\nConnected members (${members.length}):`);
        for (const m of members) {
          console.log(`  - ${m.name} (${m.type}) [${m.status ?? 'unknown'}]`);
        }
        console.log(`\nRegistered agents (${agents.length}):`);
        for (const a of agents) {
          console.log(`  - ${a.name} (${a.type})`);
        }
        console.log(`\nRegistered humans (${humans.length}):`);
        for (const h of humans) {
          console.log(`  - ${h.name}`);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start');
        process.exit(1);
      }
    });
}
