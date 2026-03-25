import Database from 'better-sqlite3';
import { MENTION_ALL, MessageType, type SkynetMessage, type AgentCard, type HumanProfile, type ScheduleInfo } from '@skynet-ai/protocol';
import type { Store } from './store.js';

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        "from" TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        reply_to TEXT,
        mentions TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages("from");
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        role TEXT,
        persona TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS humans (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        task_template TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
      CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
    `);
  }

  // ── Messages ──

  save(msg: SkynetMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, type, "from", timestamp, payload, reply_to, mentions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.type,
      msg.from,
      msg.timestamp,
      JSON.stringify(msg.payload),
      msg.replyTo ?? null,
      msg.mentions && msg.mentions.length > 0 ? JSON.stringify(msg.mentions) : null,
    );
  }

  getMessages(limit: number = 100, before?: number, after?: number): SkynetMessage[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (before) { conditions.push('timestamp < ?'); params.push(before); }
    if (after) { conditions.push('timestamp > ?'); params.push(after); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM messages ${where} ORDER BY timestamp DESC LIMIT ?`,
    ).all(...params, limit);

    return (rows as Array<Record<string, unknown>>).reverse().map(this.rowToMessage);
  }

  getById(id: string): SkynetMessage | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMessage(row) : undefined;
  }

  getMessagesFor(agentId: string, limit: number = 3, since?: number): SkynetMessage[] {
    const baseCondition = '(mentions IS NOT NULL AND (instr(mentions, ?) > 0 OR instr(mentions, ?) > 0))';
    const rows = since
      ? this.db.prepare(`
          SELECT * FROM messages
          WHERE ${baseCondition} AND timestamp > ?
          ORDER BY timestamp DESC LIMIT ?
        `).all(agentId, MENTION_ALL, since, limit)
      : this.db.prepare(`
          SELECT * FROM messages
          WHERE ${baseCondition}
          ORDER BY timestamp DESC LIMIT ?
        `).all(agentId, MENTION_ALL, limit);

    return (rows as Array<Record<string, unknown>>).reverse().map(this.rowToMessage);
  }

  getExecutionLogs(agentId?: string, limit: number = 50): SkynetMessage[] {
    const rows = agentId
      ? this.db.prepare(`
          SELECT * FROM messages
          WHERE type = ? AND "from" = ?
          ORDER BY timestamp DESC LIMIT ?
        `).all(MessageType.EXECUTION_LOG, agentId, limit)
      : this.db.prepare(`
          SELECT * FROM messages
          WHERE type = ?
          ORDER BY timestamp DESC LIMIT ?
        `).all(MessageType.EXECUTION_LOG, limit);

    return (rows as Array<Record<string, unknown>>).reverse().map(this.rowToMessage);
  }

  // ── Agents ──

  saveAgent(agent: AgentCard): void {
    this.db.prepare(
      'INSERT INTO agents (id, name, type, role, persona, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(agent.id, agent.name, agent.type, agent.role ?? null, agent.persona ?? null, agent.createdAt);
  }

  listAgents(): AgentCard[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at').all();
    return (rows as Array<Record<string, unknown>>).map(this.rowToAgent);
  }

  getAgent(idOrName: string): AgentCard | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ? OR name = ?').get(idOrName, idOrName) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToAgent(row) : undefined;
  }

  deleteAgent(id: string): boolean {
    const result = this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Humans ──

  saveHuman(human: HumanProfile): void {
    this.db.prepare(
      'INSERT INTO humans (id, name, created_at) VALUES (?, ?, ?)',
    ).run(human.id, human.name, human.createdAt);
  }

  listHumans(): HumanProfile[] {
    const rows = this.db.prepare('SELECT * FROM humans ORDER BY created_at').all();
    return (rows as Array<Record<string, unknown>>).map(this.rowToHuman);
  }

  getHuman(idOrName: string): HumanProfile | undefined {
    const row = this.db.prepare('SELECT * FROM humans WHERE id = ? OR name = ?').get(idOrName, idOrName) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToHuman(row) : undefined;
  }

  deleteHuman(id: string): boolean {
    const result = this.db.prepare('DELETE FROM humans WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Name Uniqueness ──

  checkNameUnique(name: string): boolean {
    const agentRow = this.db.prepare('SELECT 1 FROM agents WHERE name = ?').get(name);
    if (agentRow) return false;
    const humanRow = this.db.prepare('SELECT 1 FROM humans WHERE name = ?').get(name);
    if (humanRow) return false;
    return true;
  }

  // ── Schedules ──

  saveSchedule(schedule: ScheduleInfo): void {
    this.db.prepare(`
      INSERT INTO schedules (id, name, cron_expr, agent_id, task_template, enabled, created_by, last_run_at, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      schedule.id,
      schedule.name,
      schedule.cronExpr,
      schedule.agentId,
      JSON.stringify(schedule.taskTemplate),
      schedule.enabled ? 1 : 0,
      schedule.createdBy ?? null,
      schedule.lastRunAt ?? null,
      schedule.nextRunAt ?? null,
      schedule.createdAt,
      schedule.updatedAt,
    );
  }

  listSchedules(agentId?: string): ScheduleInfo[] {
    const rows = agentId
      ? this.db.prepare('SELECT * FROM schedules WHERE agent_id = ? ORDER BY created_at').all(agentId)
      : this.db.prepare('SELECT * FROM schedules ORDER BY created_at').all();
    return (rows as Array<Record<string, unknown>>).map(this.rowToSchedule);
  }

  getSchedule(id: string): ScheduleInfo | undefined {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSchedule(row) : undefined;
  }

  updateSchedule(
    id: string,
    patch: Partial<Pick<ScheduleInfo, 'name' | 'cronExpr' | 'agentId' | 'taskTemplate' | 'enabled'>>,
  ): ScheduleInfo | undefined {
    const existing = this.getSchedule(id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.cronExpr !== undefined) { sets.push('cron_expr = ?'); params.push(patch.cronExpr); }
    if (patch.agentId !== undefined) { sets.push('agent_id = ?'); params.push(patch.agentId); }
    if (patch.taskTemplate !== undefined) { sets.push('task_template = ?'); params.push(JSON.stringify(patch.taskTemplate)); }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0); }

    if (sets.length === 0) return existing;

    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.db.prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getSchedule(id);
  }

  updateScheduleLastRun(id: string, timestamp: number, nextRunAt?: number): void {
    if (nextRunAt !== undefined) {
      this.db.prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, nextRunAt, Date.now(), id);
    } else {
      this.db.prepare('UPDATE schedules SET last_run_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, Date.now(), id);
    }
  }

  deleteSchedule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Helpers ──

  private rowToMessage(row: Record<string, unknown>): SkynetMessage {
    return {
      id: row.id as string,
      type: row.type as SkynetMessage['type'],
      from: row.from as string,
      timestamp: row.timestamp as number,
      payload: JSON.parse(row.payload as string),
      replyTo: (row.reply_to as string) || undefined,
      mentions: row.mentions ? JSON.parse(row.mentions as string) as string[] : undefined,
    };
  }

  private rowToAgent(row: Record<string, unknown>): AgentCard {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as AgentCard['type'],
      role: (row.role as string) || undefined,
      persona: (row.persona as string) || undefined,
      createdAt: row.created_at as number,
      status: 'offline',
    };
  }

  private rowToSchedule(row: Record<string, unknown>): ScheduleInfo {
    return {
      id: row.id as string,
      name: row.name as string,
      cronExpr: row.cron_expr as string,
      agentId: row.agent_id as string,
      taskTemplate: JSON.parse(row.task_template as string),
      enabled: (row.enabled as number) === 1,
      createdBy: (row.created_by as string) || undefined,
      lastRunAt: (row.last_run_at as number) || undefined,
      nextRunAt: (row.next_run_at as number) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private rowToHuman(row: Record<string, unknown>): HumanProfile {
    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as number,
    };
  }

  close(): void {
    this.db.close();
  }
}
