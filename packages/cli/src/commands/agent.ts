import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { AgentType } from '@skynet/protocol';
import type { AgentProfile } from '@skynet/protocol';
import { detectAvailableAgents, createAdapter, AgentRunner } from '@skynet/agent-adapter';
import { getWorkspaceDir } from '../config.js';
import { selectServer, getServerUrl } from '../utils/server-select.js';

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage agents')
    .option('--server <id>', 'Server UUID or name')
    .action(async (opts) => {
      // Bare `skynet agent`: select server → select agent → start idle
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      let agents: AgentProfile[];
      try {
        const res = await fetch(`${url}/api/agents`);
        agents = await res.json() as AgentProfile[];
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }

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

      const agentProfile = selected as AgentProfile;
      const wsDir = getWorkspaceDir(workspace.id);
      const workDir = join(wsDir, agentProfile.id, 'work');

      const adapter = createAdapter(agentProfile.type as AgentType, workDir);
      const runner = new AgentRunner({
        serverUrl: url,
        roomId: '__idle__',
        adapter,
        agentName: agentProfile.name,
        persona: agentProfile.persona,
        projectRoot: workDir,
      });

      process.on('SIGINT', async () => {
        console.log('\nDisconnecting agent...');
        await runner.stop();
        process.exit(0);
      });

      console.log(`Agent "${agentProfile.name}" started in idle state.`);
      console.log('Use join commands to add to rooms.');
      console.log('Press Ctrl+C to stop.');

      // Keep process alive
      await new Promise(() => {});
    });

  agent
    .command('new')
    .description('Create a new agent')
    .option('--server <id>', 'Server UUID or name')
    .action(async (opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

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

      const answers = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Agent name:', validate: (v: string) => v.trim() ? true : 'Name is required' },
        { type: 'list', name: 'type', message: 'Agent type:', choices: typeChoices },
        { type: 'input', name: 'role', message: 'Role (optional):' },
        { type: 'input', name: 'persona', message: 'Persona description (optional):' },
      ]);

      try {
        const res = await fetch(`${url}/api/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: answers.name.trim(),
            type: answers.type,
            role: answers.role || undefined,
            persona: answers.persona || undefined,
          }),
        });

        if (res.status === 201) {
          const body = await res.json() as AgentProfile;
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
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });

  agent
    .command('list')
    .description('List all agents')
    .option('--server <id>', 'Server UUID or name')
    .action(async (opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/agents`);
        const agents = await res.json() as AgentProfile[];

        if (agents.length === 0) {
          console.log('No agents.');
          return;
        }

        console.log(`Agents (${agents.length}):`);
        for (const a of agents) {
          console.log(`  - ${a.name} (${a.type})${a.role ? ` [${a.role}]` : ''} [${a.id}]`);
        }
      } catch {
        console.error(`Failed to connect to server at ${url}`);
        process.exit(1);
      }
    });

  agent
    .command('join')
    .description('Add an agent to a room')
    .argument('<agent>', 'Agent name or UUID')
    .argument('<room>', 'Room name or UUID')
    .option('--server <id>', 'Server UUID or name')
    .action(async (agentId: string, roomId: string, opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/agents/${encodeURIComponent(agentId)}/join/${encodeURIComponent(roomId)}`, {
          method: 'POST',
        });

        if (res.ok) {
          const body = await res.json() as { roomId: string; agentId: string };
          console.log(`Agent joined room. (agent: ${body.agentId}, room: ${body.roomId})`);
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

  agent
    .command('leave')
    .description('Remove an agent from a room')
    .argument('<agent>', 'Agent name or UUID')
    .argument('<room>', 'Room name or UUID')
    .option('--server <id>', 'Server UUID or name')
    .action(async (agentId: string, roomId: string, opts) => {
      const workspace = await selectServer(opts);
      const url = getServerUrl(workspace);

      try {
        const res = await fetch(`${url}/api/agents/${encodeURIComponent(agentId)}/leave/${encodeURIComponent(roomId)}`, {
          method: 'POST',
        });

        if (res.ok) {
          console.log('Agent left room.');
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
