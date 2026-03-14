#!/usr/bin/env tsx
/**
 * E2E Test: Skill Marketplace
 *
 * Tests the full Skynet workflow using real claude-code agents and
 * chat pipe mode for human simulation:
 *
 *   1. Create workspace + agents (pm, backend, frontend) + human
 *   2. Start workspace & agents
 *   3. Send initial project brief to PM via pipe mode
 *   4. Monitor agent collaboration and track progress
 *   5. Optionally send follow-up steering messages
 *   6. Verify deliverables in working directory
 *   7. Clean up
 *
 * Usage:
 *   pnpm e2e:skill-marketplace [options]
 *
 * Options:
 *   --timeout <seconds>    Overall timeout (default: 1800 = 30 min)
 *   --workdir <path>       Agent working directory (default: /tmp/skynet-e2e-marketplace)
 *   --skip-setup           Skip setup phase (reuse existing workspace)
 *   --skip-cleanup         Skip cleanup phase (keep workspace running)
 *   --brief <text>         Custom initial brief (default: skill marketplace brief)
 *   --workspace <name>     Workspace name (default: e2e-skill-marketplace)
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Config ──────────────────────────────────────────────────────────────────

const RUN_ID = randomUUID().slice(0, 8);

const DEFAULTS = {
  workspace: `e2e-marketplace-${RUN_ID}`,
  human: 'tester',
  workdir: `/tmp/skynet-e2e-marketplace-${RUN_ID}`,
  timeoutS: 1800,
  brief: [
    '@pm We\'re building a skill marketplace website where users can browse,',
    'publish, and install skills for AI agents.',
    'The MVP needs: (1) a browse page with search and category filters,',
    '(2) a skill detail page, and (3) a publish page.',
    'Please break this into tasks for @backend and @frontend —',
    'define the API contract between them, then kick things off.',
    'Start with backend API + seed data so frontend can develop against real endpoints.',
  ].join(' '),
} as const;

interface Config {
  workspace: string;
  human: string;
  workdir: string;
  timeoutS: number;
  brief: string;
  skipSetup: boolean;
  skipCleanup: boolean;
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Config {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  return {
    workspace: get('--workspace') ?? DEFAULTS.workspace,
    human: get('--human') ?? DEFAULTS.human,
    workdir: get('--workdir') ?? DEFAULTS.workdir,
    timeoutS: parseInt(get('--timeout') ?? String(DEFAULTS.timeoutS), 10),
    brief: get('--brief') ?? DEFAULTS.brief,
    skipSetup: has('--skip-setup'),
    skipCleanup: has('--skip-cleanup'),
  };
}

// ─── Logging ─────────────────────────────────────────────────────────────────

const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function log(phase: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${DIM}${ts}${RESET} ${BLUE}[${phase}]${RESET} ${msg}`);
}

function logOk(phase: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${DIM}${ts}${RESET} ${GREEN}[${phase}]${RESET} ${msg}`);
}

function logWarn(phase: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${DIM}${ts}${RESET} ${YELLOW}[${phase}]${RESET} ${msg}`);
}

function logErr(phase: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`${DIM}${ts}${RESET} ${RED}[${phase}]${RESET} ${msg}`);
}

// ─── CLI helpers ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function skynet(args: string, opts?: { silent?: boolean }): string {
  const cmd = `node ${ROOT}/packages/cli/dist/index.js ${args}`;
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: opts?.silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return out.trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    const detail = e.stderr || e.stdout || e.message;
    throw new Error(`skynet ${args.split(' ')[0]} failed: ${detail}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Phases ──────────────────────────────────────────────────────────────────

interface AgentDef {
  name: string;
  role: string;
  persona: string;
}

const AGENTS: AgentDef[] = [
  {
    name: 'pm',
    role: 'project manager',
    persona:
      'You are a senior PM. Break down tasks, assign them to the right team members via @mentions, track progress, and resolve blockers. Always communicate in clear, actionable terms.',
  },
  {
    name: 'backend',
    role: 'backend engineer',
    persona:
      'You are a backend engineer. Build REST APIs, design database schemas, and implement server-side logic. Coordinate with @frontend on API contracts.',
  },
  {
    name: 'frontend',
    role: 'frontend engineer',
    persona:
      'You are a frontend engineer. Build React UI components, pages, and handle styling. Coordinate with @backend on API contracts.',
  },
];

async function setup(cfg: Config): Promise<void> {
  log('setup', `workspace=${cfg.workspace}  workdir=${cfg.workdir}`);

  // Ensure workdir exists
  if (!existsSync(cfg.workdir)) {
    mkdirSync(cfg.workdir, { recursive: true });
    log('setup', `Created workdir: ${cfg.workdir}`);
  }

  // Create workspace
  log('setup', 'Creating workspace...');
  skynet(`workspace new --name ${cfg.workspace}`);
  logOk('setup', 'Workspace created');

  // Start workspace as daemon
  log('setup', 'Starting workspace daemon...');
  skynet(`workspace start ${cfg.workspace} -d`);
  await sleep(1000); // Give server time to bind
  logOk('setup', 'Workspace started');

  // Create agents
  for (const agent of AGENTS) {
    log('setup', `Creating agent: ${agent.name} (${agent.role})`);
    skynet(
      `agent new --workspace ${cfg.workspace} --name ${agent.name} --type claude-code` +
        ` --role "${agent.role}" --persona "${agent.persona}" --workdir ${cfg.workdir}`,
    );
  }
  logOk('setup', `Created ${AGENTS.length} agents`);

  // Create human
  log('setup', `Creating human: ${cfg.human}`);
  skynet(`human new --workspace ${cfg.workspace} --name ${cfg.human}`);
  logOk('setup', 'Human created');

  // Start agents as daemons
  for (const agent of AGENTS) {
    log('setup', `Starting agent: ${agent.name}`);
    skynet(`agent start ${agent.name} --workspace ${cfg.workspace}`);
    await sleep(500);
  }
  logOk('setup', 'All agents started');

  // Wait for agents to come online
  log('setup', 'Waiting for agents to connect...');
  await waitForAgentsOnline(cfg, 60_000);
  logOk('setup', 'All agents online');
}

async function waitForAgentsOnline(cfg: Config, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const expected = new Set(AGENTS.map((a) => a.name));

  while (Date.now() < deadline) {
    try {
      const status = skynet(`status --workspace ${cfg.workspace}`, { silent: true });
      // Status format: "  pm [idle]" / "  pm [busy]" / "  pm [offline]"
      // An agent is "online" if its status is anything other than "offline"
      const online = new Set<string>();
      for (const name of expected) {
        const pattern = new RegExp(`^\\s*${name}\\s+\\[(?!offline)\\w+\\]`, 'm');
        if (pattern.test(status)) {
          online.add(name);
        }
      }
      log('setup', `Agents online: ${online.size}/${expected.size} (${[...online].join(', ') || 'none'})`);
      if (online.size === expected.size) return;
    } catch {
      // Status command may fail while server is starting
    }
    await sleep(3000);
  }

  throw new Error(`Agents did not come online within ${timeoutMs / 1000}s`);
}

interface TaggedLine {
  text: string;
  fromSelf: boolean;
}

interface PipeSession {
  proc: ChildProcess;
  messages: TaggedLine[];
  send: (text: string) => void;
  waitForAgentMessage: (pattern: RegExp, timeoutMs?: number, sinceIdx?: number) => Promise<string>;
  close: () => Promise<void>;
}

function openPipe(cfg: Config): PipeSession {
  const proc = spawn(
    'node',
    [
      `${ROOT}/packages/cli/dist/index.js`,
      'chat',
      '--workspace',
      cfg.workspace,
      '--name',
      cfg.human,
      '--pipe',
    ],
    {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  const messages: TaggedLine[] = [];
  let buffer = '';
  // Track whether current message block is from self (human) or an agent
  let currentBlockFromSelf = false;
  const selfHeaderPattern = new RegExp(`👤\\s*${cfg.human}`);

  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // Keep incomplete line in buffer
    for (const line of lines) {
      if (!line.trim()) continue;

      // Detect message header lines to track sender
      if (line.includes('👤') || line.includes('🤖') || line.includes('📡')) {
        currentBlockFromSelf = selfHeaderPattern.test(line);
      }

      messages.push({ text: line, fromSelf: currentBlockFromSelf });
      // Print received messages in real-time
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`${DIM}${ts}${RESET} ${DIM}[pipe]${RESET} ${line}`);
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) logWarn('pipe-err', text);
  });

  const send = (text: string): void => {
    log('human', `>>> ${text}`);
    proc.stdin!.write(text + '\n');
  };

  const waitForAgentMessage = (pattern: RegExp, timeoutMs = 120_000, sinceIdx?: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const startIdx = sinceIdx ?? messages.length;
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for agent message matching ${pattern} (${timeoutMs / 1000}s)`,
          ),
        );
      }, timeoutMs);

      const check = setInterval(() => {
        for (let i = startIdx; i < messages.length; i++) {
          if (!messages[i].fromSelf && pattern.test(messages[i].text)) {
            clearTimeout(timer);
            clearInterval(check);
            resolve(messages[i].text);
            return;
          }
        }
      }, 500);
    });
  };

  const close = async (): Promise<void> => {
    proc.stdin!.end();
    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      setTimeout(() => {
        proc.kill('SIGTERM');
        resolve();
      }, 5000);
    });
  };

  return { proc, messages, send, waitForAgentMessage, close };
}

async function runTest(cfg: Config): Promise<TestResult> {
  const result: TestResult = {
    phases: [],
    startTime: Date.now(),
    endTime: 0,
    success: false,
  };

  log('test', 'Opening pipe connection as human...');
  const pipe = openPipe(cfg);

  // Wait a moment for pipe to connect
  await sleep(2000);

  // Phase 1: Send initial brief to PM and wait for PM to respond
  const phase1Start = Date.now();
  log('test', 'Phase 1: Sending initial brief to PM...');
  let msgIdx = pipe.messages.length;
  pipe.send(cfg.brief);

  try {
    // Wait for PM to respond — match the PM's header line (🤖 pm ->)
    await pipe.waitForAgentMessage(/🤖\s*pm\s*->/i, 180_000, msgIdx);
    logOk('test', 'Phase 1: PM responded');
    result.phases.push({
      name: 'PM responds to brief',
      success: true,
      durationMs: Date.now() - phase1Start,
    });
  } catch (err) {
    logErr('test', `Phase 1 failed: ${(err as Error).message}`);
    result.phases.push({
      name: 'PM responds to brief',
      success: false,
      durationMs: Date.now() - phase1Start,
      error: (err as Error).message,
    });
    await pipe.close();
    return result;
  }

  // Phase 2: Wait for PM to mention @backend or @frontend (task assignment)
  const phase2Start = Date.now();
  log('test', 'Phase 2: Waiting for PM to assign tasks to backend/frontend...');
  try {
    // PM should mention @backend or @frontend in task assignments
    await pipe.waitForAgentMessage(/@(backend|frontend)/i, 300_000, msgIdx);
    logOk('test', 'Phase 2: PM assigned tasks to team');
    result.phases.push({
      name: 'PM assigns tasks',
      success: true,
      durationMs: Date.now() - phase2Start,
    });
  } catch (err) {
    logWarn('test', `Phase 2: ${(err as Error).message}`);
    result.phases.push({
      name: 'PM assigns tasks',
      success: false,
      durationMs: Date.now() - phase2Start,
      error: (err as Error).message,
    });
  }

  // Phase 3: Monitor agent activity — wait for agents to produce output
  const phase3Start = Date.now();
  log('test', 'Phase 3: Monitoring agent activity...');

  // Poll for file creation in workdir as a sign of agent activity
  const maxWaitMs = Math.min((cfg.timeoutS * 1000) - (Date.now() - result.startTime), 600_000);
  const deadline = Date.now() + maxWaitMs;
  let filesCreated = false;

  while (Date.now() < deadline) {
    try {
      const files = readdirSync(cfg.workdir);
      // Check if agents have created any project files (not just .git or config)
      const projectFiles = files.filter(
        (f) => !f.startsWith('.') && f !== 'node_modules',
      );
      if (projectFiles.length > 0) {
        logOk('test', `Phase 3: Agents created files: ${projectFiles.join(', ')}`);
        filesCreated = true;
        break;
      }
    } catch {
      // workdir may not exist yet
    }
    await sleep(5000);
  }

  result.phases.push({
    name: 'Agents produce output',
    success: filesCreated,
    durationMs: Date.now() - phase3Start,
    error: filesCreated ? undefined : 'No project files created in workdir',
  });

  // Phase 4: Send a follow-up status check
  const phase4Start = Date.now();
  log('test', 'Phase 4: Asking PM for status update...');
  msgIdx = pipe.messages.length;
  pipe.send('@pm What\'s the current status? Any blockers?');

  try {
    await pipe.waitForAgentMessage(/🤖\s*pm\s*->/i, 180_000, msgIdx);
    logOk('test', 'Phase 4: PM responded with status');
    result.phases.push({
      name: 'PM status update',
      success: true,
      durationMs: Date.now() - phase4Start,
    });
  } catch (err) {
    logWarn('test', `Phase 4: ${(err as Error).message}`);
    result.phases.push({
      name: 'PM status update',
      success: false,
      durationMs: Date.now() - phase4Start,
      error: (err as Error).message,
    });
  }

  // Phase 5: Request wrap-up
  const phase5Start = Date.now();
  log('test', 'Phase 5: Requesting wrap-up...');
  msgIdx = pipe.messages.length;
  pipe.send(
    '@pm Let\'s wrap up. Make sure everything builds and runs, then give me a summary of what was delivered.',
  );

  try {
    await pipe.waitForAgentMessage(/🤖\s*pm\s*->/i, 300_000, msgIdx);
    logOk('test', 'Phase 5: PM delivered summary');
    result.phases.push({
      name: 'PM wrap-up summary',
      success: true,
      durationMs: Date.now() - phase5Start,
    });
  } catch (err) {
    logWarn('test', `Phase 5: ${(err as Error).message}`);
    result.phases.push({
      name: 'PM wrap-up summary',
      success: false,
      durationMs: Date.now() - phase5Start,
      error: (err as Error).message,
    });
  }

  await pipe.close();

  // Final workdir check
  log('test', 'Checking final deliverables...');
  try {
    const files = readdirSync(cfg.workdir);
    const projectFiles = files.filter(
      (f) => !f.startsWith('.') && f !== 'node_modules',
    );
    log('test', `Workdir contents: ${projectFiles.join(', ') || '(empty)'}`);
    log('test', `Total messages exchanged: ${pipe.messages.length}`);
  } catch {
    logWarn('test', 'Could not read workdir');
  }

  result.success = result.phases.filter((p) => p.success).length >= 2;
  return result;
}

async function cleanup(cfg: Config): Promise<void> {
  log('cleanup', 'Stopping agents...');
  for (const agent of AGENTS) {
    try {
      skynet(`agent stop ${agent.name} --workspace ${cfg.workspace}`, { silent: true });
    } catch {
      // Agent may already be stopped
    }
  }

  log('cleanup', 'Stopping workspace...');
  try {
    skynet(`workspace stop ${cfg.workspace}`, { silent: true });
  } catch {
    // Workspace may already be stopped
  }

  // Wait a moment for processes to exit
  await sleep(1000);

  log('cleanup', 'Deleting workspace...');
  try {
    // workspace list format: "  - name (host:port) [status] [uuid]"
    const list = skynet('workspace list', { silent: true });
    const match = list.match(new RegExp(`${cfg.workspace}[^\\[]*\\[[^\\]]*\\]\\s*\\[([^\\]]+)\\]`));
    if (match) {
      skynet(`workspace delete ${match[1]} --force`, { silent: true });
      logOk('cleanup', 'Workspace deleted');
    } else {
      logWarn('cleanup', 'Workspace not found in list');
    }
  } catch {
    logWarn('cleanup', 'Could not delete workspace (may need manual cleanup)');
  }

  logOk('cleanup', 'Done');
}

// ─── Result reporting ────────────────────────────────────────────────────────

interface PhaseResult {
  name: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

interface TestResult {
  phases: PhaseResult[];
  startTime: number;
  endTime: number;
  success: boolean;
}

function printReport(result: TestResult): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  E2E Test Report: Skill Marketplace');
  console.log('═'.repeat(60));

  const totalMs = result.endTime - result.startTime;
  const totalMin = (totalMs / 60_000).toFixed(1);

  for (const phase of result.phases) {
    const icon = phase.success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const dur = (phase.durationMs / 1000).toFixed(1);
    console.log(`  ${icon} ${phase.name} (${dur}s)`);
    if (phase.error) {
      console.log(`    ${DIM}${phase.error}${RESET}`);
    }
  }

  console.log('─'.repeat(60));
  const passed = result.phases.filter((p) => p.success).length;
  const total = result.phases.length;
  const status = result.success
    ? `${GREEN}PASSED${RESET}`
    : `${RED}FAILED${RESET}`;
  console.log(`  Result: ${status}  (${passed}/${total} phases)  Duration: ${totalMin}m`);
  console.log('═'.repeat(60) + '\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));

  console.log('\n' + '═'.repeat(60));
  console.log('  Skynet E2E Test: Skill Marketplace');
  console.log('═'.repeat(60));
  console.log(`  Workspace:  ${cfg.workspace}`);
  console.log(`  Workdir:    ${cfg.workdir}`);
  console.log(`  Timeout:    ${cfg.timeoutS}s`);
  console.log(`  Skip setup: ${cfg.skipSetup}`);
  console.log(`  Skip clean: ${cfg.skipCleanup}`);
  console.log('═'.repeat(60) + '\n');

  // Global timeout
  const globalTimer = setTimeout(() => {
    logErr('timeout', `Global timeout reached (${cfg.timeoutS}s). Aborting.`);
    process.exit(2);
  }, cfg.timeoutS * 1000);

  // Trap SIGINT for cleanup
  let interrupted = false;
  process.on('SIGINT', async () => {
    if (interrupted) process.exit(1);
    interrupted = true;
    logWarn('signal', 'SIGINT received, cleaning up...');
    if (!cfg.skipCleanup) {
      await cleanup(cfg);
    }
    process.exit(1);
  });

  try {
    // Setup
    if (!cfg.skipSetup) {
      await setup(cfg);
    } else {
      log('setup', 'Skipped (--skip-setup)');
    }

    // Run test
    const result = await runTest(cfg);
    result.endTime = Date.now();

    // Report
    printReport(result);

    // Cleanup
    if (!cfg.skipCleanup) {
      await cleanup(cfg);
    } else {
      log('cleanup', 'Skipped (--skip-cleanup)');
    }

    clearTimeout(globalTimer);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    logErr('fatal', (err as Error).message);
    if (!cfg.skipCleanup) {
      await cleanup(cfg);
    }
    clearTimeout(globalTimer);
    process.exit(1);
  }
}

main();
