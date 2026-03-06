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

const SKYNET_DIR = join(homedir(), '.skynet');
const SERVERS_PATH = join(SKYNET_DIR, 'servers.json');

export function getSkynetDir(): string {
  return SKYNET_DIR;
}

export function ensureSkynetDir(): void {
  if (!existsSync(SKYNET_DIR)) {
    mkdirSync(SKYNET_DIR, { recursive: true });
  }
}

export function getServersPath(): string {
  return SERVERS_PATH;
}

export function listWorkspaces(): WorkspaceEntry[] {
  ensureSkynetDir();
  if (!existsSync(SERVERS_PATH)) {
    return [];
  }
  try {
    const raw = readFileSync(SERVERS_PATH, 'utf-8');
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
  writeFileSync(SERVERS_PATH, JSON.stringify({ servers: workspaces }, null, 2) + '\n', 'utf-8');

  // Create workspace directory and config
  const wsDir = join(SKYNET_DIR, entry.id);
  mkdirSync(wsDir, { recursive: true });
  const wsConfig: WorkspaceConfig = { host: entry.host, port: entry.port };
  writeFileSync(join(wsDir, 'config.json'), JSON.stringify(wsConfig, null, 2) + '\n', 'utf-8');
}

export function getWorkspace(idOrName: string): WorkspaceEntry | undefined {
  const workspaces = listWorkspaces();
  return workspaces.find((w) => w.id === idOrName || w.name === idOrName);
}

export function getWorkspaceDir(workspaceId: string): string {
  return join(SKYNET_DIR, workspaceId);
}

export function getServerUrl(workspace: WorkspaceEntry): string {
  return `http://${workspace.host === '0.0.0.0' ? 'localhost' : workspace.host}:${workspace.port}`;
}

export function loadWorkspaceConfig(workspaceId: string): WorkspaceConfig | undefined {
  const configPath = join(SKYNET_DIR, workspaceId, 'config.json');
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
