/**
 * Daemon entry point — spawned as a detached child process by the CLI.
 *
 * Usage:
 *   node daemon-entry.js workspace --workspace-id <id>
 *   node daemon-entry.js agent --workspace-id <id> --agent-id <id> --server-url <url>
 *   node daemon-entry.js chat --workspace-id <id> --human-id <id> --human-name <name> --server-url <url>
 */
import { join } from 'node:path';
import { createWriteStream, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AgentType } from '@skynet-ai/protocol';
import { getWorkspaceDir } from './config.js';
import { writePid, removePid, getPidFilePath } from './daemon.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'workspace-id': { type: 'string' },
    'agent-id': { type: 'string' },
    'server-url': { type: 'string' },
    'human-id': { type: 'string' },
    'human-name': { type: 'string' },
  },
});

const mode = positionals[0];
const workspaceId = values['workspace-id'];

if (!mode || !workspaceId) {
  process.stderr.write('Usage: daemon-entry.js <workspace|agent|chat> --workspace-id <id> [...]\n');
  process.exit(1);
}

const wsDir = getWorkspaceDir(workspaceId);

// Determine PID file and log file
let pidFile: string;
let logFileName: string;

if (mode === 'workspace') {
  pidFile = getPidFilePath(workspaceId, 'server');
  logFileName = 'server.log';
} else if (mode === 'chat') {
  pidFile = getPidFilePath(workspaceId, 'chat', values['human-id']);
  logFileName = `chat-${values['human-id']}.log`;
} else {
  pidFile = getPidFilePath(workspaceId, 'agent', values['agent-id']);
  logFileName = `${values['agent-id']}.log`;
}

const logDir = join(wsDir, 'logs');
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, logFileName);

// Redirect stdout/stderr to log file
const logStream = createWriteStream(logFile, { flags: 'a' });
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
  logStream.write(chunk);
  return origStdoutWrite(chunk, ...(args as []));
}) as typeof process.stdout.write;
process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
  logStream.write(chunk);
  return origStderrWrite(chunk, ...(args as []));
}) as typeof process.stderr.write;

// Write PID file
writePid(pidFile, process.pid);

// Clean up PID file on exit
function cleanup(): void {
  removePid(pidFile);
}
process.on('exit', cleanup);

async function runWorkspace(): Promise<void> {
  const { SkynetWorkspace, SqliteStore } = await import('@skynet-ai/workspace');

  // Read workspace config to get host/port
  const { loadWorkspaceConfig } = await import('./config.js');
  const config = loadWorkspaceConfig(workspaceId!);
  if (!config) {
    console.error(`No config found for workspace ${workspaceId}`);
    process.exit(1);
  }

  const dbPath = join(wsDir, 'data.db');
  const store = new SqliteStore(dbPath);
  const srv = new SkynetWorkspace({
    port: config.port,
    host: config.host,
    store,
    logFile,
  });

  // Handle SIGTERM for graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Daemon received SIGTERM, shutting down...');
    await srv.stop();
    process.exit(0);
  });

  await srv.start();
  console.log(`[daemon] Workspace server started on ${config.host}:${config.port} (pid: ${process.pid})`);
}

async function runAgent(): Promise<void> {
  const agentId = values['agent-id'];
  const serverUrl = values['server-url'];

  if (!agentId || !serverUrl) {
    console.error('--agent-id and --server-url are required for agent mode');
    process.exit(1);
  }

  const { readFileSync, existsSync } = await import('node:fs');
  const { createAdapter, AgentRunner } = await import('@skynet-ai/agent-adapter');

  // Fetch agent profile from workspace server
  const res = await fetch(`${serverUrl}/api/agents/${agentId}`);
  if (!res.ok) {
    console.error(`Failed to fetch agent profile: ${res.statusText}`);
    process.exit(1);
  }

  const agentProfile = await res.json() as { id: string; name: string; type: string; role?: string; persona?: string };

  // Load local config for workDir
  const agentDir = join(wsDir, agentId);
  let workDir = join(agentDir, 'work');
  const localConfigPath = join(agentDir, 'agent.json');
  if (existsSync(localConfigPath)) {
    try {
      const localConfig = JSON.parse(readFileSync(localConfigPath, 'utf-8')) as { workDir?: string };
      if (localConfig.workDir) workDir = localConfig.workDir;
    } catch {
      // Use default workDir
    }
  }

  const adapter = createAdapter(agentProfile.type as AgentType, workDir);
  const statePath = join(agentDir, 'state.json');

  const runner = new AgentRunner({
    serverUrl,
    adapter,
    agentId: agentProfile.id,
    agentName: agentProfile.name,
    role: agentProfile.role,
    persona: agentProfile.persona,
    projectRoot: workDir,
    statePath,
    logFile,
  });

  process.on('SIGTERM', async () => {
    console.log('Daemon received SIGTERM, disconnecting agent...');
    await runner.stop();
    process.exit(0);
  });

  await runner.start();
  console.log(`[daemon] Agent "${agentProfile.name}" connected (pid: ${process.pid})`);

  // Keep alive
  await new Promise(() => {});
}

async function runChat(): Promise<void> {
  const humanId = values['human-id'];
  const humanName = values['human-name'];
  const serverUrl = values['server-url'];

  if (!humanId || !humanName || !serverUrl) {
    console.error('--human-id, --human-name, and --server-url are required for chat mode');
    process.exit(1);
  }

  const { runChatWeixin } = await import('@skynet-ai/chat');

  process.on('SIGTERM', () => {
    console.log('Daemon received SIGTERM, shutting down chat bridge...');
    process.exit(0);
  });

  console.log(`[daemon] WeChat bridge starting for "${humanName}" (pid: ${process.pid})`);
  await runChatWeixin({ serverUrl, name: humanName, id: humanId });
}

// Run the appropriate mode
if (mode === 'workspace') {
  runWorkspace().catch((err) => {
    console.error('Workspace daemon error:', err);
    process.exit(1);
  });
} else if (mode === 'agent') {
  runAgent().catch((err) => {
    console.error('Agent daemon error:', err);
    process.exit(1);
  });
} else if (mode === 'chat') {
  runChat().catch((err) => {
    console.error('Chat daemon error:', err);
    process.exit(1);
  });
} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}
