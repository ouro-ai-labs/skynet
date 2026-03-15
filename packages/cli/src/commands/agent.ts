import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { AgentType } from '@skynet-ai/protocol';
import type { AgentCard } from '@skynet-ai/protocol';
import { detectAvailableAgents, createAdapter, AgentRunner } from '@skynet-ai/agent-adapter';
import { getWorkspaceDir } from '../config.js';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';
import { spawnDaemon, getPidFilePath, getRunningPid, stopProcess } from '../daemon.js';

interface AgentLocalConfig {
  workDir?: string;
}

function loadAgentLocalConfig(agentDir: string): AgentLocalConfig {
  const configPath = join(agentDir, 'agent.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as AgentLocalConfig;
  } catch {
    return {};
  }
}

function saveAgentLocalConfig(agentDir: string, config: AgentLocalConfig): void {
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Maps skynet AgentType to the agent name used by `npx skills add -a`. */
const SKILLS_AGENT_MAP: Record<string, string> = {
  [AgentType.CLAUDE_CODE]: 'claude-code',
  [AgentType.GEMINI_CLI]: 'gemini-cli',
  [AgentType.CODEX_CLI]: 'codex-cli',
  [AgentType.GENERIC]: 'claude-code', // fallback: install as claude-code layout
};

interface SkillSpec {
  source: string;
  skillName?: string;
}

/**
 * Parse a skill specifier in the format `source[:skill-name]`.
 * The source may contain colons (e.g. `https://github.com/...`), so we only
 * split on the *last* colon that is not part of a URL scheme (`://`).
 */
export function parseSkillSpec(raw: string): SkillSpec {
  // Find the last colon that is not part of `://`
  let splitIdx = -1;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === ':') {
      // Skip `://` patterns (colon followed by //)
      if (i + 2 < raw.length && raw[i + 1] === '/' && raw[i + 2] === '/') {
        continue;
      }
      // Skip Windows drive letters like C:
      if (i === 1 && /^[a-zA-Z]$/.test(raw[0])) {
        continue;
      }
      splitIdx = i;
      break;
    }
  }
  if (splitIdx === -1) {
    return { source: raw };
  }
  return {
    source: raw.slice(0, splitIdx),
    skillName: raw.slice(splitIdx + 1) || undefined,
  };
}

/**
 * Install skills into an agent's working directory via `npx skills add`.
 * Warns on failure but does not throw — skill installation should not block agent creation.
 */
export async function installSkills(
  specs: string[],
  agentType: string,
  workDir: string,
): Promise<void> {
  if (specs.length === 0) return;

  const targetAgent = SKILLS_AGENT_MAP[agentType] ?? 'claude-code';

  for (const raw of specs) {
    const { source, skillName } = parseSkillSpec(raw);
    const args = ['skills', 'add', source, '-a', targetAgent, '-y'];
    if (skillName) {
      args.push('-s', skillName);
    }

    console.log(`Installing skill: ${raw} ...`);
    try {
      execFileSync('npx', args, { cwd: workDir, stdio: 'inherit' });
    } catch {
      console.warn(`Warning: failed to install skill '${raw}'. Skipping.`);
    }
  }
}

async function fetchAgents(url: string): Promise<AgentCard[]> {
  try {
    const res = await fetch(`${url}/api/agents`);
    return await res.json() as AgentCard[];
  } catch {
    console.error(`Failed to connect to workspace at ${url}`);
    console.error('Is the workspace running? Start it with: skynet workspace start <name>');
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
  const agentDir = join(wsDir, agentProfile.id);
  const localConfig = loadAgentLocalConfig(agentDir);
  const workDir = localConfig.workDir ?? join(agentDir, 'work');
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

function startAgentDaemon(agentProfile: AgentCard, workspaceId: string, serverUrl: string): void {
  const pidFile = getPidFilePath(workspaceId, 'agent', agentProfile.id);
  const existingPid = getRunningPid(pidFile);
  if (existingPid) {
    console.error(`Agent "${agentProfile.name}" is already running (pid: ${existingPid}).`);
    process.exit(1);
  }

  const logFile = join(getWorkspaceDir(workspaceId), 'logs', `${agentProfile.id}.log`);
  const pid = spawnDaemon([
    'agent',
    '--workspace-id', workspaceId,
    '--agent-id', agentProfile.id,
    '--server-url', serverUrl,
  ], logFile);

  console.log(`Agent "${agentProfile.name}" started in background (pid: ${pid}).`);
  console.log(`Logs: ${logFile}`);
  console.log(`Stop with: skynet agent stop ${agentProfile.name}`);
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
        choices: agents.map((a) => {
          const icon = a.status === 'busy' ? '\u{1F7E1}' : a.status === 'error' ? '\u{1F534}' : a.status === 'idle' ? '\u{1F7E2}' : '\u26AB';
          return {
            name: `${icon} ${a.name} (${a.type})${a.role ? ` - ${a.role}` : ''}`,
            value: a,
          };
        }),
      }]);

      await runAgent(selected as AgentCard, workspace.id, url);
    });

  agent
    .command('start <name-or-id>')
    .description('Start an agent by name or UUID')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('-d, --daemon', 'Run as daemon (default, kept for backward compatibility)')
    .option('-f, --foreground', 'Run in foreground instead of daemon mode')
    .action(async (nameOrId: string, opts: { workspace?: string; daemon?: boolean; foreground?: boolean }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);

      if (opts.foreground) {
        await runAgent(agentProfile, workspace.id, url);
      } else {
        startAgentDaemon(agentProfile, workspace.id, url);
      }
    });

  agent
    .command('new')
    .description('Create a new agent')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Agent name (skip interactive prompt)')
    .option('--type <type>', 'Agent type: claude-code, gemini-cli, codex-cli, generic')
    .option('--role <role>', 'Agent role')
    .option('--persona <persona>', 'Persona description')
    .option('--workdir <path>', 'Custom working directory for the agent (default: ~/.skynet/<ws>/<id>/work)')
    .option('--skills <spec...>', 'Install skills (repeatable, format: source[:skill-name])')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      let name: string;
      let type: string;
      let role: string | undefined;
      let persona: string | undefined;
      let skills: string[] = opts.skills ?? [];

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
        if (skills.length === 0) {
          questions.push({ type: 'input' as const, name: 'skills', message: 'Skills to install (comma-separated source[:name], or leave empty):' });
        }

        const answers = await inquirer.prompt(questions);

        name = opts.name ?? answers.name;
        type = opts.type ?? answers.type;
        role = opts.role ?? answers.role;
        persona = opts.persona ?? answers.persona;
        if (skills.length === 0 && answers.skills) {
          skills = (answers.skills as string).split(',').map((s: string) => s.trim()).filter(Boolean);
        }
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
          mkdirSync(agentDir, { recursive: true });
          const customWorkDir = opts.workdir ? resolve(opts.workdir) : undefined;
          const effectiveWorkDir = customWorkDir ?? join(agentDir, 'work');
          mkdirSync(effectiveWorkDir, { recursive: true });

          // Save local config (workDir only if custom)
          if (customWorkDir) {
            saveAgentLocalConfig(agentDir, { workDir: customWorkDir });
            console.log(`Working directory: ${customWorkDir}`);
          }

          const profile = [
            `# ${body.name}`,
            '',
            `- Type: ${body.type}`,
            body.role ? `- Role: ${body.role}` : null,
            body.persona ? `- Persona: ${body.persona}` : null,
          ].filter(Boolean).join('\n') + '\n';
          writeFileSync(join(agentDir, 'profile.md'), profile, 'utf-8');

          // Install skills into the agent's working directory
          await installSkills(skills, type, effectiveWorkDir);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to create agent: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
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

        // Stop daemon if running
        const pidFile = getPidFilePath(workspace.id, 'agent', agentProfile.id);
        const runningPid = getRunningPid(pidFile);
        if (runningPid) {
          await stopProcess(pidFile);
          console.log(`Agent daemon stopped (pid: ${runningPid}).`);
        }

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
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
        process.exit(1);
      }
    });

  agent
    .command('interrupt <name-or-id>')
    .description('Interrupt agent\'s current task')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (nameOrId: string, opts: { workspace?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);

      try {
        const res = await fetch(`${url}/api/agents/${agentProfile.id}/interrupt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          console.log(`Interrupt sent to agent '${agentProfile.name}'.`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to interrupt: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
        process.exit(1);
      }
    });

  agent
    .command('forget <name-or-id>')
    .description('Clear agent\'s conversation history (start fresh)')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (nameOrId: string, opts: { workspace?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);

      try {
        const res = await fetch(`${url}/api/agents/${agentProfile.id}/forget`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          console.log(`Forget sent to agent '${agentProfile.name}'. Session reset.`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to forget: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
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
          const pidFile = getPidFilePath(workspace.id, 'agent', a.id);
          const daemonPid = getRunningPid(pidFile);
          const icon = a.status === 'busy' ? '\u{1F7E1}' : a.status === 'error' ? '\u{1F534}' : a.status === 'idle' ? '\u{1F7E2}' : '\u26AB';
          const daemonInfo = daemonPid ? ` (daemon pid: ${daemonPid})` : '';
          console.log(`  ${icon} ${a.name} (${a.type})${a.role ? ` [${a.role}]` : ''} [${a.id}]${daemonInfo}`);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
        process.exit(1);
      }
    });

  agent
    .command('stop <name-or-id>')
    .description('Stop an agent daemon')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (nameOrId: string, opts: { workspace?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);

      const pidFile = getPidFilePath(workspace.id, 'agent', agentProfile.id);
      const stopped = await stopProcess(pidFile);

      if (stopped) {
        console.log(`Agent "${agentProfile.name}" stopped.`);
      } else {
        console.log(`Agent "${agentProfile.name}" is not running as a daemon.`);
      }
    });

  agent
    .command('status <name-or-id>')
    .description('Show agent daemon status')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (nameOrId: string, opts: { workspace?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);

      const pidFile = getPidFilePath(workspace.id, 'agent', agentProfile.id);
      const pid = getRunningPid(pidFile);

      if (pid) {
        console.log(`Agent "${agentProfile.name}" is running as daemon (pid: ${pid}).`);
      } else {
        console.log(`Agent "${agentProfile.name}" is not running as a daemon.`);
      }
    });

  agent
    .command('logs <name-or-id>')
    .description('Tail agent logs')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output', true)
    .action(async (nameOrId: string, opts: { workspace?: string; lines: string; follow: boolean }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const agents = await fetchAgents(url);
      const agentProfile = resolveAgent(agents, nameOrId);

      const logFile = join(getWorkspaceDir(workspace.id), 'logs', `${agentProfile.id}.log`);

      const args = ['-n', opts.lines];
      if (opts.follow) args.push('-f');
      args.push(logFile);

      const tail = spawn('tail', args, { stdio: 'inherit' });
      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    });
}
