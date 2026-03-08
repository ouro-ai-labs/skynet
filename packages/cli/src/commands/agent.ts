import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { Command } from 'commander';
import { AgentType } from '@skynet-ai/protocol';
import type { AgentCard } from '@skynet-ai/protocol';
import { detectAvailableAgents, createAdapter, AgentRunner } from '@skynet-ai/agent-adapter';
import { getWorkspaceDir } from '../config.js';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

async function fetchAgents(url: string): Promise<AgentCard[]> {
  try {
    const res = await fetch(`${url}/api/agents`);
    return await res.json() as AgentCard[];
  } catch {
    console.error(`Failed to connect to workspace at ${url}`);
    process.exit(1);
  }
}

function resolveAgent(agents: AgentCard[], nameOrId: string): AgentCard {
  const match = agents.find((a) => a.id === nameOrId || a.name === nameOrId);
  if (!match) {
    console.error(`Agent '${nameOrId}' not found. Run 'skynet agent list' to see available agents.`);
    process.exit(1);
  }
  return match;
}

async function runAgent(agentProfile: AgentCard, workspaceId: string, serverUrl: string): Promise<void> {
  const wsDir = getWorkspaceDir(workspaceId);
  const workDir = join(wsDir, agentProfile.id, 'work');
  const logFile = join(wsDir, 'logs', `${agentProfile.id}.log`);

  const adapter = createAdapter(agentProfile.type as AgentType, workDir);
  const statePath = join(wsDir, agentProfile.id, 'state.json');
  const runner = new AgentRunner({
    serverUrl,
    adapter,
    agentId: agentProfile.id,
    agentName: agentProfile.name,
    role: agentProfile.role,
    persona: agentProfile.persona,
    projectRoot: workDir,
    statePath,
    logFile,
  });

  process.on('SIGINT', async () => {
    console.log('\nDisconnecting agent...');
    await runner.stop();
    process.exit(0);
  });

  await runner.start();
  console.log(`Agent "${agentProfile.name}" connected to workspace.`);
  console.log('Press Ctrl+C to stop.');

  // Keep process alive
  await new Promise(() => {});
}

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage agents')
    .enablePositionalOptions()
    .passThroughOptions()
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (opts) => {
      // Bare `skynet agent`: select workspace → select agent → start
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);

      if (agents.length === 0) {
        console.error('No agents registered. Run \'skynet agent new\' to create one.');
        process.exit(1);
      }

      const { default: inquirer } = await import('inquirer');
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select agent:',
        choices: agents.map((a) => ({
          name: `${a.name} (${a.type})${a.role ? ` - ${a.role}` : ''}`,
          value: a,
        })),
      }]);

      await runAgent(selected as AgentCard, workspace.id, url);
    });

  agent
    .command('start <name-or-id>')
    .description('Start an agent by name or UUID')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (nameOrId: string, opts: { workspace?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);
      await runAgent(agentProfile, workspace.id, url);
    });

  agent
    .command('new')
    .description('Create a new agent')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Agent name (skip interactive prompt)')
    .option('--type <type>', 'Agent type: claude-code, gemini-cli, codex-cli, generic')
    .option('--role <role>', 'Agent role')
    .option('--persona <persona>', 'Persona description')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      let name: string;
      let type: string;
      let role: string | undefined;
      let persona: string | undefined;

      if (opts.name && opts.type) {
        name = opts.name;
        type = opts.type;
        role = opts.role;
        persona = opts.persona;
      } else {
        const { default: inquirer } = await import('inquirer');

        console.log('Detecting available agent types...');
        const detected = await detectAvailableAgents(process.cwd());
        const available = detected.filter((d) => d.available);

        const typeChoices = available.length > 0
          ? available.map((d) => ({ name: d.name, value: d.type }))
          : [
              { name: 'Claude Code', value: AgentType.CLAUDE_CODE },
              { name: 'Gemini CLI', value: AgentType.GEMINI_CLI },
              { name: 'Codex CLI', value: AgentType.CODEX_CLI },
              { name: 'Generic', value: AgentType.GENERIC },
            ];

        const questions = [];
        if (!opts.name) {
          questions.push({ type: 'input' as const, name: 'name', message: 'Agent name:', validate: (v: string) => v.trim() ? true : 'Name is required' as const });
        }
        if (!opts.type) {
          questions.push({ type: 'list' as const, name: 'type', message: 'Agent type:', choices: typeChoices });
        }
        questions.push({ type: 'input' as const, name: 'role', message: 'Role (optional):' });
        questions.push({ type: 'input' as const, name: 'persona', message: 'Persona description (optional):' });

        const answers = await inquirer.prompt(questions);

        name = opts.name ?? answers.name;
        type = opts.type ?? answers.type;
        role = opts.role ?? answers.role;
        persona = opts.persona ?? answers.persona;
      }

      try {
        const res = await fetch(`${url}/api/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            type,
            role: role || undefined,
            persona: persona || undefined,
          }),
        });

        if (res.status === 201) {
          const body = await res.json() as AgentCard;
          console.log(`Agent '${body.name}' created. (ID: ${body.id})`);

          // Create local agent directory and profile
          const agentDir = join(getWorkspaceDir(workspace.id), body.id);
          mkdirSync(join(agentDir, 'work'), { recursive: true });

          const profile = [
            `# ${body.name}`,
            '',
            `- Type: ${body.type}`,
            body.role ? `- Role: ${body.role}` : null,
            body.persona ? `- Persona: ${body.persona}` : null,
          ].filter(Boolean).join('\n') + '\n';
          writeFileSync(join(agentDir, 'profile.md'), profile, 'utf-8');
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to create agent: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        process.exit(1);
      }
    });

  agent
    .command('delete <id>')
    .description('Delete an agent by UUID')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--force', 'Skip confirmation prompt')
    .action(async (agentId: string, opts: { workspace?: string; force?: boolean }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        // Fetch agent profile for confirmation message
        const getRes = await fetch(`${url}/api/agents/${agentId}`);
        if (getRes.status === 404) {
          console.error(`Agent '${agentId}' not found. Run 'skynet agent list' to see available agents.`);
          process.exit(1);
        }
        const agentProfile = await getRes.json() as AgentCard;

        if (!opts.force) {
          const { default: inquirer } = await import('inquirer');
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Delete agent '${agentProfile.name}' (${agentProfile.id})?`,
            default: false,
          }]);
          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        const res = await fetch(`${url}/api/agents/${agentProfile.id}`, { method: 'DELETE' });

        if (res.status === 200) {
          // Clean up local agent directory
          const agentDir = join(getWorkspaceDir(workspace.id), agentProfile.id);
          if (existsSync(agentDir)) {
            rmSync(agentDir, { recursive: true, force: true });
          }
          console.log(`Agent '${agentProfile.name}' deleted.`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to delete agent: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        process.exit(1);
      }
    });

  agent
    .command('list')
    .description('List all agents')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/agents`);
        const agents = await res.json() as AgentCard[];

        if (agents.length === 0) {
          console.log('No agents.');
          return;
        }

        console.log(`Agents (${agents.length}):`);
        for (const a of agents) {
          console.log(`  - ${a.name} (${a.type})${a.role ? ` [${a.role}]` : ''} [${a.id}]`);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        process.exit(1);
      }
    });
}
