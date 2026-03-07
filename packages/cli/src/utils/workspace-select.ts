import { listWorkspaces, getWorkspaceByIdOrName, getServerUrl, type WorkspaceEntry } from '../config.js';

export function selectWorkspace(opts: { workspace?: string }): WorkspaceEntry {
  if (opts.workspace) {
    const ws = getWorkspaceByIdOrName(opts.workspace);
    if (!ws) {
      console.error(`Workspace '${opts.workspace}' not found. Run 'skynet workspace list' to see available workspaces.`);
      process.exit(1);
    }
    return ws;
  }

  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    console.error('No workspaces configured. Run \'skynet workspace new\' to create one.');
    process.exit(1);
  }

  if (workspaces.length === 1) {
    return workspaces[0];
  }

  console.error('Multiple workspaces found. Use --workspace <name-or-id> to specify which one.');
  console.error('Run \'skynet workspace list\' to see available workspaces.');
  process.exit(1);
}

export { getServerUrl };
