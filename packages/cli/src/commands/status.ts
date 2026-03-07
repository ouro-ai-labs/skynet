import { Command } from 'commander';
import type { AgentCard, AgentStatus, HumanProfile } from '@skynet/protocol';
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

        // Build a map of connected member id → status
        const onlineMap = new Map<string, AgentStatus>();
        for (const m of members) {
          onlineMap.set(m.id, m.status ?? 'idle');
        }

        console.log(`Skynet Workspace: ${workspace.name}`);
        console.log(`Server: ${url}`);

        // ── Agents ──
        console.log(`\nAgents (${agents.length}):`);
        if (agents.length === 0) {
          console.log('  (none)');
        }
        for (const a of agents) {
          const status = onlineMap.has(a.id) ? statusBadge(onlineMap.get(a.id)) : 'offline';
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
          const status = onlineMap.has(h.id) ? 'online' : 'offline';
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
