import { Command } from 'commander';
import type { ScheduleInfo } from '@skynet-ai/protocol';
import { selectWorkspace, getServerUrl } from '../utils/workspace-select.js';

export function registerScheduleCommand(program: Command): void {
  const schedule = program
    .command('schedule')
    .description('Manage scheduled tasks')
    .enablePositionalOptions()
    .passThroughOptions();

  schedule
    .command('list')
    .description('List all schedules')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--agent <agent-id>', 'Filter by agent ID')
    .action(async (opts: { workspace?: string; agent?: string }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        const query = opts.agent ? `?agentId=${encodeURIComponent(opts.agent)}` : '';
        const res = await fetch(`${url}/api/schedules${query}`);
        const schedules = await res.json() as ScheduleInfo[];

        if (schedules.length === 0) {
          console.log('No schedules.');
          return;
        }

        console.log(`Schedules (${schedules.length}):`);
        for (const s of schedules) {
          const status = s.enabled ? 'enabled' : 'disabled';
          const lastRun = s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'never';
          const nextRun = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '-';
          console.log(`  - ${s.name} [${s.id}]`);
          console.log(`    cron: ${s.cronExpr} | agent: ${s.agentId} | ${status}`);
          console.log(`    last: ${lastRun} | next: ${nextRun}`);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
        process.exit(1);
      }
    });

  schedule
    .command('delete <id>')
    .description('Delete a schedule by ID')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .option('--force', 'Skip confirmation prompt')
    .action(async (scheduleId: string, opts: { workspace?: string; force?: boolean }) => {
      const workspace = selectWorkspace(opts);
      const url = getServerUrl(workspace);

      try {
        // Fetch schedule for confirmation
        const getRes = await fetch(`${url}/api/schedules/${scheduleId}`);
        if (getRes.status === 404) {
          console.error(`Schedule '${scheduleId}' not found.`);
          process.exit(1);
        }
        const sched = await getRes.json() as ScheduleInfo;

        if (!opts.force) {
          const { default: inquirer } = await import('inquirer');
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Delete schedule '${sched.name}' (${sched.id})?`,
            default: false,
          }]);
          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        const res = await fetch(`${url}/api/schedules/${sched.id}`, { method: 'DELETE' });
        if (res.ok) {
          console.log(`Schedule '${sched.name}' deleted.`);
        } else {
          const body = await res.json() as { error?: string };
          console.error(`Failed to delete schedule: ${body.error ?? res.statusText}`);
          process.exit(1);
        }
      } catch {
        console.error(`Failed to connect to workspace at ${url}`);
        console.error('Is the workspace running? Start it with: skynet workspace start <name>');
        process.exit(1);
      }
    });

  schedule
    .command('enable <id>')
    .description('Enable a schedule')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (scheduleId: string, opts: { workspace?: string }) => {
      await toggleSchedule(scheduleId, true, opts);
    });

  schedule
    .command('disable <id>')
    .description('Disable a schedule')
    .option('--workspace <name-or-id>', 'Workspace name or UUID')
    .action(async (scheduleId: string, opts: { workspace?: string }) => {
      await toggleSchedule(scheduleId, false, opts);
    });
}

async function toggleSchedule(scheduleId: string, enabled: boolean, opts: { workspace?: string }): Promise<void> {
  const workspace = selectWorkspace(opts);
  const url = getServerUrl(workspace);

  try {
    const res = await fetch(`${url}/api/schedules/${scheduleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });

    if (res.ok) {
      const sched = await res.json() as ScheduleInfo;
      console.log(`Schedule '${sched.name}' ${enabled ? 'enabled' : 'disabled'}.`);
    } else if (res.status === 404) {
      console.error(`Schedule '${scheduleId}' not found.`);
      process.exit(1);
    } else {
      const body = await res.json() as { error?: string };
      console.error(`Failed: ${body.error ?? res.statusText}`);
      process.exit(1);
    }
  } catch {
    console.error(`Failed to connect to workspace at ${url}`);
    console.error('Is the workspace running? Start it with: skynet workspace start <name>');
    process.exit(1);
  }
}
