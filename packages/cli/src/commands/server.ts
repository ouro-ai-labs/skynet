import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { SkynetServer, SqliteStore } from '@skynet/server';
import {
  ensureSkynetDir,
  listWorkspaces,
  addWorkspace,
  getWorkspace,
  getWorkspaceDir,
  type WorkspaceEntry,
} from '../config.js';

async function startServer(workspace: WorkspaceEntry): Promise<void> {
  const wsDir = getWorkspaceDir(workspace.id);
  const dbPath = join(wsDir, 'data.db');

  const store = new SqliteStore(dbPath);
  const srv = new SkynetServer({ port: workspace.port, host: workspace.host, store });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await srv.stop();
    process.exit(0);
  });

  await srv.start();
  console.log(`Skynet server "${workspace.name}" running on ${workspace.host}:${workspace.port}`);
  console.log(`Database: ${dbPath}`);
}

export function registerServerCommand(program: Command): void {
  const server = program
    .command('server')
    .description('Manage Skynet servers')
    .action(async () => {
      // Bare `skynet server`: interactive select and start
      const workspaces = listWorkspaces();
      if (workspaces.length === 0) {
        console.error('No servers configured. Run \'skynet server new\' to create one.');
        process.exit(1);
      }

      let workspace: WorkspaceEntry;
      if (workspaces.length === 1) {
        workspace = workspaces[0];
      } else {
        const { default: inquirer } = await import('inquirer');
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select server to start:',
          choices: workspaces.map((w) => ({
            name: `${w.name} (${w.host}:${w.port})`,
            value: w,
          })),
        }]);
        workspace = selected;
      }

      await startServer(workspace);
    });

  server
    .command('new')
    .description('Create a new server workspace')
    .option('--name <name>', 'Server name (skip interactive prompt)')
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
          { type: 'input', name: 'name', message: 'Server name:', validate: (v: string) => v.trim() ? true : 'Name is required' },
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

      const existing = getWorkspace(name);
      if (existing) {
        console.error(`Server '${name}' already exists.`);
        process.exit(1);
      }

      const entry: WorkspaceEntry = {
        id: randomUUID(),
        name: name.trim(),
        host,
        port: parseInt(port, 10),
      };

      addWorkspace(entry);
      console.log(`Server '${entry.name}' created.`);
      console.log(`  ID:   ${entry.id}`);
      console.log(`  Host: ${entry.host}:${entry.port}`);
      console.log(`  Dir:  ${getWorkspaceDir(entry.id)}`);
      console.log('\nStart it with: skynet server');
    });

  server
    .command('list')
    .description('List all server workspaces')
    .action(() => {
      const workspaces = listWorkspaces();
      if (workspaces.length === 0) {
        console.log('No servers configured. Run \'skynet server new\' to create one.');
        return;
      }

      console.log(`Servers (${workspaces.length}):`);
      for (const w of workspaces) {
        console.log(`  - ${w.name} (${w.host}:${w.port}) [${w.id}]`);
      }
    });

  server
    .command('start')
    .description('Start a server by name or UUID')
    .argument('[name-or-id]', 'Server name or UUID')
    .option('--server <id>', 'Server UUID or name')
    .action(async (nameOrId?: string, opts?: { server?: string }) => {
      const identifier = nameOrId ?? opts?.server;
      let workspace: WorkspaceEntry | undefined;

      if (identifier) {
        workspace = getWorkspace(identifier);
        if (!workspace) {
          console.error(`Server '${identifier}' not found. Run 'skynet server list' to see available servers.`);
          process.exit(1);
        }
      } else {
        const workspaces = listWorkspaces();
        if (workspaces.length === 0) {
          console.error('No servers configured. Run \'skynet server new\' to create one.');
          process.exit(1);
        }
        if (workspaces.length === 1) {
          workspace = workspaces[0];
        } else {
          const { default: inquirer } = await import('inquirer');
          const { selected } = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: 'Select server to start:',
            choices: workspaces.map((w) => ({
              name: `${w.name} (${w.host}:${w.port})`,
              value: w,
            })),
          }]);
          workspace = selected;
        }
      }

      await startServer(workspace!);
    });
}
