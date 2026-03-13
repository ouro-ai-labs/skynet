import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { SkynetWorkspace, SqliteStore } from '@skynet-ai/workspace';
import {
  ensureSkynetDir,
  listWorkspaces,
  addWorkspace,
  removeWorkspace,
  getWorkspace,
  getWorkspaceByIdOrName,
  getWorkspaceDir,
  type WorkspaceEntry,
} from '../config.js';
import { spawnDaemon, getPidFilePath, getRunningPid, stopProcess } from '../daemon.js';

async function startServer(workspace: WorkspaceEntry): Promise<void> {
  const wsDir = getWorkspaceDir(workspace.id);
  const dbPath = join(wsDir, 'data.db');
  const logFile = join(wsDir, 'logs', 'server.log');

  const store = new SqliteStore(dbPath);
  const srv = new SkynetWorkspace({ port: workspace.port, host: workspace.host, store, logFile });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await srv.stop();
    process.exit(0);
  });

  await srv.start();
  console.log(`Skynet workspace "${workspace.name}" running on ${workspace.host}:${workspace.port}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Logs: ${logFile}`);
}

function startDaemon(workspace: WorkspaceEntry): void {
  const pidFile = getPidFilePath(workspace.id, 'server');
  const existingPid = getRunningPid(pidFile);
  if (existingPid) {
    console.error(`Workspace "${workspace.name}" is already running (pid: ${existingPid}).`);
    process.exit(1);
  }

  const logFile = join(getWorkspaceDir(workspace.id), 'logs', 'server.log');
  const pid = spawnDaemon([
    'workspace',
    '--workspace-id', workspace.id,
  ], logFile);

  console.log(`Workspace "${workspace.name}" started in background (pid: ${pid}).`);
  console.log(`Logs: ${logFile}`);
  console.log(`Stop with: skynet workspace stop ${workspace.name}`);
}

function resolveWorkspaceArg(identifier?: string): WorkspaceEntry {
  if (!identifier) {
    console.error('Missing required argument: workspace name or UUID. Run \'skynet workspace list\' to see available workspaces.');
    process.exit(1);
  }

  const entry = getWorkspaceByIdOrName(identifier);
  if (!entry) {
    console.error(`Workspace '${identifier}' not found. Run 'skynet workspace list' to see available workspaces.`);
    process.exit(1);
  }
  return entry!;
}

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Manage Skynet workspaces')
    .action(async () => {
      console.error('Missing required argument: workspace name or UUID. Run \'skynet workspace list\' to see available workspaces.');
      console.error('Usage: skynet workspace start <name-or-id>');
      process.exit(1);
    });

  workspace
    .command('new')
    .description('Create a new workspace')
    .option('--name <name>', 'Workspace name (skip interactive prompt)')
    .option('--host <host>', 'Host (default: 0.0.0.0)')
    .option('--port <port>', 'Port (default: 4117)')
    .action(async (opts) => {
      ensureSkynetDir();

      let name: string;
      let host: string;
      let port: string;

      if (opts.name) {
        name = opts.name;
        host = opts.host ?? '0.0.0.0';
        port = opts.port ?? '4117';
      } else {
        const { default: inquirer } = await import('inquirer');
        const { name: inputName } = await inquirer.prompt([
          { type: 'input', name: 'name', message: 'Workspace name:', validate: (v: string) => v.trim() ? true : 'Name is required' },
        ]);
        name = inputName;
        if (!opts.host) {
          const { host: inputHost } = await inquirer.prompt([
            { type: 'input', name: 'host', message: 'Host:', default: '0.0.0.0' },
          ]);
          host = inputHost;
        } else {
          host = opts.host;
        }
        if (!opts.port) {
          const { port: inputPort } = await inquirer.prompt([
            { type: 'input', name: 'port', message: 'Port:', default: '4117', validate: (v: string) => /^\d+$/.test(v) ? true : 'Must be a number' },
          ]);
          port = inputPort;
        } else {
          port = opts.port;
        }
      }

      const existing = getWorkspaceByIdOrName(name);
      if (existing) {
        console.error(`Workspace '${name}' already exists.`);
        process.exit(1);
      }

      const entry: WorkspaceEntry = {
        id: randomUUID(),
        name: name.trim(),
        host,
        port: parseInt(port, 10),
      };

      addWorkspace(entry);
      console.log(`Workspace '${entry.name}' created.`);
      console.log(`  ID:   ${entry.id}`);
      console.log(`  Host: ${entry.host}:${entry.port}`);
      console.log(`  Dir:  ${getWorkspaceDir(entry.id)}`);
      console.log(`\nStart it with: skynet workspace start ${entry.name}`);
    });

  workspace
    .command('list')
    .description('List all workspaces')
    .action(() => {
      const workspaces = listWorkspaces();
      if (workspaces.length === 0) {
        console.log('No workspaces configured. Run \'skynet workspace new\' to create one.');
        return;
      }

      console.log(`Workspaces (${workspaces.length}):`);
      for (const w of workspaces) {
        const pidFile = getPidFilePath(w.id, 'server');
        const pid = getRunningPid(pidFile);
        const status = pid ? `running (pid: ${pid})` : 'stopped';
        console.log(`  - ${w.name} (${w.host}:${w.port}) [${status}] [${w.id}]`);
      }
    });

  workspace
    .command('delete <id>')
    .description('Delete a workspace and all its data by UUID')
    .option('--force', 'Skip confirmation prompt')
    .action(async (id: string, opts: { force?: boolean }) => {
      const entry = getWorkspace(id);
      if (!entry) {
        console.error(`Workspace '${id}' not found. Run 'skynet workspace list' to see available workspaces.`);
        process.exit(1);
      }

      // Stop the workspace if it's running as a daemon
      const pidFile = getPidFilePath(entry.id, 'server');
      const runningPid = getRunningPid(pidFile);
      if (runningPid) {
        if (!opts.force) {
          const { default: inquirer } = await import('inquirer');
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Workspace '${entry.name}' is running (pid: ${runningPid}). Stop and delete it?`,
            default: false,
          }]);
          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }
        await stopProcess(pidFile);
        console.log('Workspace process stopped.');
      } else if (!opts.force) {
        const { default: inquirer } = await import('inquirer');
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Delete workspace '${entry.name}' (${entry.id})? This will remove all data including agents and messages.`,
          default: false,
        }]);
        if (!confirm) {
          console.log('Cancelled.');
          return;
        }
      }

      removeWorkspace(entry.id);
      console.log(`Workspace '${entry.name}' deleted.`);
    });

  workspace
    .command('start')
    .description('Start a workspace by name or UUID')
    .argument('[name-or-id]', 'Workspace name or UUID')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('-d, --daemon', 'Run in background as a daemon process')
    .action(async (nameOrId?: string, opts?: { workspace?: string; daemon?: boolean }) => {
      const entry = resolveWorkspaceArg(nameOrId ?? opts?.workspace);

      if (opts?.daemon) {
        startDaemon(entry);
      } else {
        await startServer(entry);
      }
    });

  workspace
    .command('stop')
    .description('Stop a workspace daemon')
    .argument('[name-or-id]', 'Workspace name or UUID')
    .action(async (nameOrId?: string) => {
      const entry = resolveWorkspaceArg(nameOrId);
      const pidFile = getPidFilePath(entry.id, 'server');
      const stopped = await stopProcess(pidFile);

      if (stopped) {
        console.log(`Workspace "${entry.name}" stopped.`);
      } else {
        console.log(`Workspace "${entry.name}" is not running.`);
      }
    });

  workspace
    .command('status')
    .description('Show workspace daemon status')
    .argument('[name-or-id]', 'Workspace name or UUID')
    .action((nameOrId?: string) => {
      const entry = resolveWorkspaceArg(nameOrId);
      const pidFile = getPidFilePath(entry.id, 'server');
      const pid = getRunningPid(pidFile);

      if (pid) {
        console.log(`Workspace "${entry.name}" is running (pid: ${pid}).`);
      } else {
        console.log(`Workspace "${entry.name}" is not running.`);
      }
    });

  workspace
    .command('logs')
    .description('Tail workspace server logs')
    .argument('[name-or-id]', 'Workspace name or UUID')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output', true)
    .action((nameOrId: string | undefined, opts: { lines: string; follow: boolean }) => {
      const entry = resolveWorkspaceArg(nameOrId);
      const logFile = join(getWorkspaceDir(entry.id), 'logs', 'server.log');

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
