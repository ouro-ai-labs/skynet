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
  console.log(`Skynet workspace "${workspace.name}" running on ${workspace.host}:${workspace.port}`);
  console.log(`Database: ${dbPath}`);
}

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Manage Skynet workspaces')
    .action(async () => {
      // Bare `skynet workspace`: start the only workspace, or error if multiple
      const workspaces = listWorkspaces();
      if (workspaces.length === 0) {
        console.error('No workspaces configured. Run \'skynet workspace new\' to create one.');
        process.exit(1);
      }
      if (workspaces.length > 1) {
        console.error('Multiple workspaces found. Use \'skynet workspace start <name-or-id>\' to specify which one.');
        console.error('Run \'skynet workspace list\' to see available workspaces.');
        process.exit(1);
      }

      await startServer(workspaces[0]);
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

      const existing = getWorkspace(name);
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
      console.log('\nStart it with: skynet workspace start');
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
        console.log(`  - ${w.name} (${w.host}:${w.port}) [${w.id}]`);
      }
    });

  workspace
    .command('start')
    .description('Start a workspace by name or UUID')
    .argument('[name-or-id]', 'Workspace name or UUID')
    .option('--workspace <id>', 'Workspace UUID or name')
    .action(async (nameOrId?: string, opts?: { workspace?: string }) => {
      const identifier = nameOrId ?? opts?.workspace;
      let entry: WorkspaceEntry | undefined;

      if (identifier) {
        entry = getWorkspace(identifier);
        if (!entry) {
          console.error(`Workspace '${identifier}' not found. Run 'skynet workspace list' to see available workspaces.`);
          process.exit(1);
        }
      } else {
        const workspaces = listWorkspaces();
        if (workspaces.length === 0) {
          console.error('No workspaces configured. Run \'skynet workspace new\' to create one.');
          process.exit(1);
        }
        if (workspaces.length > 1) {
          console.error('Multiple workspaces found. Use \'skynet workspace start <name-or-id>\' to specify which one.');
          console.error('Run \'skynet workspace list\' to see available workspaces.');
          process.exit(1);
        }
        entry = workspaces[0];
      }

      await startServer(entry!);
    });
}
