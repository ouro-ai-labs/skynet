import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SkynetConfig {
  server: {
    port: number;
    host: string;
    dbPath: string;
  };
  client: {
    serverUrl: string;
  };
}

const SKYNET_DIR = join(homedir(), '.skynet');
const CONFIG_PATH = join(SKYNET_DIR, 'config.json');

const DEFAULT_CONFIG: SkynetConfig = {
  server: {
    port: 4117,
    host: '0.0.0.0',
    dbPath: join(SKYNET_DIR, 'data.db'),
  },
  client: {
    serverUrl: 'http://localhost:4117',
  },
};

export function getSkynetDir(): string {
  return SKYNET_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function ensureSkynetDir(): void {
  if (!existsSync(SKYNET_DIR)) {
    mkdirSync(SKYNET_DIR, { recursive: true });
  }
}

export function loadConfig(): SkynetConfig {
  ensureSkynetDir();

  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const user = JSON.parse(raw) as Partial<SkynetConfig>;
    return {
      server: { ...DEFAULT_CONFIG.server, ...user.server },
      client: { ...DEFAULT_CONFIG.client, ...user.client },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function initConfig(): void {
  ensureSkynetDir();

  if (existsSync(CONFIG_PATH)) {
    return;
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf-8');
}
