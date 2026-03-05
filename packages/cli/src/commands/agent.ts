import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { AgentType } from '@skynet/protocol';
import { detectAvailableAgents, createAdapter, AgentRunner } from '@skynet/agent-adapter';

export function registerAgentCommand(program: Command): void {
  const agent = program.command('agent').description('Manage agents');

  agent
    .command('start')
    .description('Connect an agent to a Skynet room')
    .argument('<room-id>', 'Room ID to join')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4117')
    .option('-t, --type <type>', 'Agent type (claude-code, gemini-cli, codex-cli)')
    .option('-n, --name <name>', 'Agent display name')
    .option('--persona <file>', 'Path to persona markdown file')
    .option('--project-root <path>', 'Project root directory', process.cwd())
    .action(async (roomId, opts) => {
      let agentType: AgentType;

      if (opts.type) {
        agentType = opts.type as AgentType;
      } else {
        // Auto-detect and let user choose
        console.log('Detecting available agents...');
        const detected = await detectAvailableAgents(opts.projectRoot);
        const available = detected.filter((d) => d.available);

        if (available.length === 0) {
          console.error('No supported agents detected. Install claude, gemini, or codex CLI.');
          process.exit(1);
        }

        console.log('Available agents:');
        available.forEach((d, i) => console.log(`  [${i + 1}] ${d.name}`));

        // Use inquirer for interactive selection
        const { default: inquirer } = await import('inquirer');
        const { choice } = await inquirer.prompt([{
          type: 'list',
          name: 'choice',
          message: 'Select agent:',
          choices: available.map((d) => ({ name: d.name, value: d.type })),
        }]);
        agentType = choice;
      }

      let persona: string | undefined;
      if (opts.persona) {
        const { readFile } = await import('node:fs/promises');
        persona = await readFile(opts.persona, 'utf-8');
      }

      const adapter = createAdapter(agentType, opts.projectRoot);
      const runner = new AgentRunner({
        serverUrl: opts.server,
        roomId,
        adapter,
        agentName: opts.name,
        persona,
        projectRoot: opts.projectRoot,
      });

      process.on('SIGINT', async () => {
        console.log('\nDisconnecting agent...');
        await runner.stop();
        process.exit(0);
      });

      const state = await runner.start();
      console.log(`Agent "${runner.agentName}" connected to room "${roomId}"`);
      console.log(`Members in room: ${state.members.map((m: { name: string }) => m.name).join(', ')}`);
      console.log('Listening for messages... (Ctrl+C to quit)');
    });
}
