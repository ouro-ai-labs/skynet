import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import type { HumanProfile } from '@skynet-ai/protocol';
import { runChatTUI, runChatPipe, runChatWeixin } from '@skynet-ai/chat';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';
import { getWorkspaceDir } from '../config.js';
import { spawnDaemon, getPidFilePath, getRunningPid, stopProcess } from '../daemon.js';

async function fetchHumans(url: string): Promise<HumanProfile[]> {
  try {
    const res = await fetch(`${url}/api/humans`);
    return await res.json() as HumanProfile[];
  } catch {
    console.error(`Failed to connect to workspace at ${url}`);
    console.error('Is the workspace running? Start it with: skynet workspace start <name>');
    process.exit(1);
  }
}

function resolveHuman(humans: HumanProfile[], name: string): HumanProfile {
  const found = humans.find((h) => h.name === name);
  if (!found) {
    console.error(`Human '${name}' not found. Available: ${humans.map((h) => h.name).join(', ')}`);
    process.exit(1);
  }
  return found;
}

async function selectHuman(
  humans: HumanProfile[],
  opts: { name?: string; pipe?: boolean; weixin?: boolean },
): Promise<HumanProfile> {
  if (opts.name) {
    return resolveHuman(humans, opts.name);
  }
  if (humans.length === 1) {
    return humans[0];
  }
  if (opts.pipe || opts.weixin) {
    console.error('Multiple humans found. Use --name to select one in pipe/weixin mode.');
    process.exit(1);
  }
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
  return selected as HumanProfile;
}

function startWeixinDaemon(human: HumanProfile, workspaceId: string, serverUrl: string): void {
  const pidFile = getPidFilePath(workspaceId, 'chat', human.id);
  const existingPid = getRunningPid(pidFile);
  if (existingPid) {
    console.error(`WeChat bridge for "${human.name}" is already running (pid: ${existingPid}).`);
    process.exit(1);
  }

  const logFile = join(getWorkspaceDir(workspaceId), 'logs', `chat-${human.id}.log`);
  const pid = spawnDaemon([
    'chat',
    '--workspace-id', workspaceId,
    '--human-id', human.id,
    '--human-name', human.name,
    '--server-url', serverUrl,
  ], logFile);

  console.log(`WeChat bridge for "${human.name}" started in background (pid: ${pid}).`);
  console.log(`Logs: ${logFile}`);
  console.log(`Stop with: skynet chat stop --name ${human.name}`);
}

export function registerChatCommand(program: Command): void {
  const chat = program
    .command('chat')
    .description('Start chat TUI or WeChat bridge as a human participant')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Human name (skip selection prompt)')
    .option('--pipe', 'Non-interactive pipe mode: read from stdin, write to stdout')
    .option('--weixin', 'WeChat bridge mode: forward messages to/from WeChat')
    .option('-f, --foreground', 'Run WeChat bridge in foreground instead of daemon mode')
    .action(async (opts) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const humans = await fetchHumans(url);

      if (humans.length === 0) {
        console.error('No humans registered. Run \'skynet human new\' to create one.');
        process.exit(1);
      }

      const human = await selectHuman(humans, opts);

      if (opts.weixin) {
        if (opts.foreground) {
          await runChatWeixin({ serverUrl: url, name: human.name, id: human.id });
        } else {
          startWeixinDaemon(human, workspace.id, url);
        }
      } else if (opts.pipe) {
        await runChatPipe({ serverUrl: url, name: human.name, id: human.id });
      } else {
        await runChatTUI({ serverUrl: url, name: human.name, id: human.id });
      }
    });

  chat
    .command('stop')
    .description('Stop WeChat bridge daemon')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Human name')
    .action(async (opts: { workspace?: string; name?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const humans = await fetchHumans(url);
      const human = await selectHuman(humans, { ...opts, weixin: true });

      const pidFile = getPidFilePath(workspace.id, 'chat', human.id);
      const stopped = await stopProcess(pidFile);

      if (stopped) {
        console.log(`WeChat bridge for "${human.name}" stopped.`);
      } else {
        console.log(`WeChat bridge for "${human.name}" is not running.`);
      }
    });

  chat
    .command('status')
    .description('Show WeChat bridge daemon status')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Human name')
    .action(async (opts: { workspace?: string; name?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const humans = await fetchHumans(url);
      const human = await selectHuman(humans, { ...opts, weixin: true });

      const pidFile = getPidFilePath(workspace.id, 'chat', human.id);
      const pid = getRunningPid(pidFile);

      if (pid) {
        console.log(`WeChat bridge for "${human.name}" is running (pid: ${pid}).`);
      } else {
        console.log(`WeChat bridge for "${human.name}" is not running.`);
      }
    });

  chat
    .command('logs')
    .description('Tail WeChat bridge logs')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--name <name>', 'Human name')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output', true)
    .action(async (opts: { workspace?: string; name?: string; lines: string; follow: boolean }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);
      const humans = await fetchHumans(url);
      const human = await selectHuman(humans, { ...opts, weixin: true });

      const logFile = join(getWorkspaceDir(workspace.id), 'logs', `chat-${human.id}.log`);

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
