import { listWorkspaces, getWorkspace, getServerUrl, type WorkspaceEntry } from '../config.js';

export async function selectServer(opts: { server?: string }): Promise<WorkspaceEntry> {
  if (opts.server) {
    const ws = getWorkspace(opts.server);
    if (!ws) {
      console.error(`Server '${opts.server}' not found. Run 'skynet server list' to see available servers.`);
      process.exit(1);
    }
    return ws;
  }

  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    console.error('No servers configured. Run \'skynet server new\' to create one.');
    process.exit(1);
  }

  if (workspaces.length === 1) {
    return workspaces[0];
  }

  const { default: inquirer } = await import('inquirer');
  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Select server:',
    choices: workspaces.map((w) => ({
      name: `${w.name} (${w.host}:${w.port})`,
      value: w,
    })),
  }]);

  return selected;
}

export { getServerUrl };
