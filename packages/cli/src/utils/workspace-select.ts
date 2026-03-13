import { getWorkspaceByIdOrName, getServerUrl, type WorkspaceEntry } from '../config.js';

export function selectWorkspace(opts: { workspace?: string }): WorkspaceEntry {
  if (!opts.workspace) {
    console.error('Missing required option: --workspace <name-or-id>. Run \'skynet workspace list\' to see available workspaces.');
    process.exit(1);
  }

  const ws = getWorkspaceByIdOrName(opts.workspace);
  if (!ws) {
    console.error(`Workspace '${opts.workspace}' not found. Run 'skynet workspace list' to see available workspaces.`);
    process.exit(1);
  }
  return ws;
}

export { getServerUrl };
