import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { Logger } from '@skynet-ai/logger';
import {
  type ScheduleInfo,
  type ScheduleCreatePayload,
  type TaskPayload,
  MessageType,
  createMessage,
} from '@skynet-ai/protocol';
import type { Store } from './store.js';

/** Callback invoked when a cron tick fires and a message needs routing. */
export type ScheduleRouteCallback = (agentId: string, taskMsg: import('@skynet-ai/protocol').SkynetMessage) => void;

export class Scheduler {
  private jobs = new Map<string, Cron>();
  private logger: Logger;

  constructor(
    private store: Store,
    private route: ScheduleRouteCallback,
    logFile?: string,
  ) {
    this.logger = new Logger('scheduler', {
      filePath: logFile,
      level: 'debug',
      console: false,
    });
  }

  /** Load all enabled schedules from DB and start cron jobs. */
  start(): void {
    const schedules = this.store.listSchedules();
    for (const s of schedules) {
      if (s.enabled) {
        this.startJob(s);
      }
    }
    this.logger.info(`Scheduler started with ${this.jobs.size} active jobs`);
  }

  /** Stop all cron jobs. */
  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
    this.logger.info('Scheduler stopped');
    this.logger.close();
  }

  create(payload: ScheduleCreatePayload, createdBy?: string): ScheduleInfo {
    const now = Date.now();
    const cron = new Cron(payload.cronExpr);
    const nextRun = cron.nextRun();
    cron.stop();

    const schedule: ScheduleInfo = {
      id: randomUUID(),
      name: payload.name,
      cronExpr: payload.cronExpr,
      agentId: payload.agentId,
      taskTemplate: payload.taskTemplate,
      enabled: true,
      createdBy,
      nextRunAt: nextRun ? nextRun.getTime() : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.store.saveSchedule(schedule);
    this.startJob(schedule);
    this.logger.info(`Schedule created: ${schedule.name} (${schedule.id}) cron=${schedule.cronExpr} agent=${schedule.agentId}`);
    return schedule;
  }

  update(
    id: string,
    patch: Partial<Pick<ScheduleInfo, 'name' | 'cronExpr' | 'agentId' | 'taskTemplate' | 'enabled'>>,
  ): ScheduleInfo | undefined {
    const updated = this.store.updateSchedule(id, patch);
    if (!updated) return undefined;

    // Restart job if cron expression or enabled state changed
    this.stopJob(id);
    if (updated.enabled) {
      this.startJob(updated);
    }

    // Update nextRunAt
    if (updated.enabled) {
      const cron = new Cron(updated.cronExpr);
      const nextRun = cron.nextRun();
      cron.stop();
      if (nextRun) {
        this.store.updateScheduleLastRun(id, updated.lastRunAt ?? 0, nextRun.getTime());
      }
    }

    this.logger.info(`Schedule updated: ${updated.name} (${id})`);
    return this.store.getSchedule(id) ?? updated;
  }

  delete(id: string): boolean {
    this.stopJob(id);
    const deleted = this.store.deleteSchedule(id);
    if (deleted) {
      this.logger.info(`Schedule deleted: ${id}`);
    }
    return deleted;
  }

  get(id: string): ScheduleInfo | undefined {
    return this.store.getSchedule(id);
  }

  list(agentId?: string): ScheduleInfo[] {
    return this.store.listSchedules(agentId);
  }

  private startJob(schedule: ScheduleInfo): void {
    if (this.jobs.has(schedule.id)) return;

    const job = new Cron(schedule.cronExpr, () => {
      this.onTick(schedule.id);
    });

    this.jobs.set(schedule.id, job);
  }

  private stopJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private onTick(scheduleId: string): void {
    // Re-read from DB to get the latest state
    const schedule = this.store.getSchedule(scheduleId);
    if (!schedule || !schedule.enabled) {
      this.stopJob(scheduleId);
      return;
    }

    const taskId = randomUUID();
    const taskPayload: TaskPayload = {
      taskId,
      title: schedule.taskTemplate.title,
      description: schedule.taskTemplate.description,
      assignee: schedule.agentId,
      status: 'pending',
      files: schedule.taskTemplate.files,
      metadata: {
        ...schedule.taskTemplate.metadata,
        scheduledBy: schedule.id,
        scheduleName: schedule.name,
      },
    };

    const msg = createMessage({
      type: MessageType.TASK_ASSIGN,
      from: 'system:scheduler',
      payload: taskPayload,
      mentions: [schedule.agentId],
    });

    // Update last run time and compute next run
    const job = this.jobs.get(scheduleId);
    const nextRun = job?.nextRun();
    this.store.updateScheduleLastRun(
      scheduleId,
      Date.now(),
      nextRun ? nextRun.getTime() : undefined,
    );

    this.route(schedule.agentId, msg);
    this.logger.info(`Schedule triggered: ${schedule.name} (${scheduleId}) → agent=${schedule.agentId} task=${taskId}`);
  }
}
