import { Command } from 'commander';
import type { AgentCard, AgentStatus, HumanProfile } from '@skynet-ai/protocol';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function statusBadge(status: AgentStatus | undefined): string {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'busy':
      return 'busy';
    case 'error':
      return 'error';
    case 'offline':
      return 'offline';
    default:
      return 'offline';
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Skynet workspace status')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        const [membersRes, agentsRes, humansRes] = await Promise.all([
          fetch(`${url}/api/members`),
          fetch(`${url}/api/agents`),
          fetch(`${url}/api/humans`),
        ]);

        const members = await membersRes.json() as AgentCard[];
        const agents = await agentsRes.json() as AgentCard[];
        const humans = await humansRes.json() as HumanProfile[];

        // Build a set of connected member ids for human online check
        const onlineIds = new Set(members.map((m) => m.id));

        console.log(`Skynet Workspace: ${workspace.name}`);
        console.log(`Server: ${url}`);

        // ── Agents (status already included from API) ──
        console.log(`\nAgents (${agents.length}):`);
        if (agents.length === 0) {
          console.log('  (none)');
        }
        for (const a of agents) {
          const status = statusBadge(a.status);
          const role = a.role ? ` | role: ${a.role}` : '';
          const persona = a.persona ? ` | persona: ${truncate(a.persona, 60)}` : '';
          console.log(`  ${a.name} [${status}]`);
          console.log(`    id: ${a.id} | type: ${a.type}${role}${persona}`);
        }

        // ── Humans ──
        console.log(`\nHumans (${humans.length}):`);
        if (humans.length === 0) {
          console.log('  (none)');
        }
        for (const h of humans) {
          const status = onlineIds.has(h.id) ? 'online' : 'offline';
          console.log(`  ${h.name} [${status}]`);
          console.log(`    id: ${h.id}`);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start');
        process.exit(1);
      }
    });
}
