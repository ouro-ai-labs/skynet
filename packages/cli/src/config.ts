import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WorkspaceEntry {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface WorkspaceConfig {
  host: string;
  port: number;
}

interface ServersRegistry {
  servers: WorkspaceEntry[];
}

export function getSkynetDir(): string {
  return process.env.SKYNET_HOME ?? join(homedir(), '.skynet');
}

function getServersFilePath(): string {
  return join(getSkynetDir(), 'servers.json');
}

export function ensureSkynetDir(): void {
  const dir = getSkynetDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getServersPath(): string {
  return getServersFilePath();
}

export function listWorkspaces(): WorkspaceEntry[] {
  ensureSkynetDir();
  const serversPath = getServersFilePath();
  if (!existsSync(serversPath)) {
    return [];
  }
  try {
    const raw = readFileSync(serversPath, 'utf-8');
    const registry = JSON.parse(raw) as ServersRegistry;
    return registry.servers ?? [];
  } catch {
    return [];
  }
}

export function addWorkspace(entry: WorkspaceEntry): void {
  ensureSkynetDir();
  const workspaces = listWorkspaces();
  workspaces.push(entry);
  writeFileSync(getServersFilePath(), JSON.stringify({ servers: workspaces }, null, 2) + '\n', 'utf-8');

  // Create workspace directory and config
  const wsDir = join(getSkynetDir(), entry.id);
  mkdirSync(wsDir, { recursive: true });
  const wsConfig: WorkspaceConfig = { host: entry.host, port: entry.port };
  writeFileSync(join(wsDir, 'config.json'), JSON.stringify(wsConfig, null, 2) + '\n', 'utf-8');
}

export function getWorkspace(idOrName: string): WorkspaceEntry | undefined {
  const workspaces = listWorkspaces();
  return workspaces.find((w) => w.id === idOrName || w.name === idOrName);
}

export function getWorkspaceDir(workspaceId: string): string {
  return join(getSkynetDir(), workspaceId);
}

export function getServerUrl(workspace: WorkspaceEntry): string {
  return `http://${workspace.host === '0.0.0.0' ? 'localhost' : workspace.host}:${workspace.port}`;
}

export function loadWorkspaceConfig(workspaceId: string): WorkspaceConfig | undefined {
  const configPath = join(getSkynetDir(), workspaceId, 'config.json');
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as WorkspaceConfig;
  } catch {
    return undefined;
  }
}
