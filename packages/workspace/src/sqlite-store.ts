import Database from 'better-sqlite3';
import type { SkynetMessage, AgentCard, HumanProfile } from '@skynet/protocol';
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
        "to" TEXT,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        reply_to TEXT,
        mentions TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages("from");

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
    `);
  }

  // ── Messages ──

  save(msg: SkynetMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, type, "from", "to", timestamp, payload, reply_to, mentions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.type,
      msg.from,
      msg.to,
      msg.timestamp,
      JSON.stringify(msg.payload),
      msg.replyTo ?? null,
      msg.mentions && msg.mentions.length > 0 ? JSON.stringify(msg.mentions) : null,
    );
  }

  getMessages(limit: number = 100, before?: number): SkynetMessage[] {
    const rows = before
      ? this.db.prepare(`
          SELECT * FROM messages WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?
        `).all(before, limit)
      : this.db.prepare(`
          SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?
        `).all(limit);

    return (rows as Array<Record<string, unknown>>).reverse().map(this.rowToMessage);
  }

  getById(id: string): SkynetMessage | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMessage(row) : undefined;
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

  // ── Name Uniqueness ──

  checkNameUnique(name: string): boolean {
    const agentRow = this.db.prepare('SELECT 1 FROM agents WHERE name = ?').get(name);
    if (agentRow) return false;
    const humanRow = this.db.prepare('SELECT 1 FROM humans WHERE name = ?').get(name);
    if (humanRow) return false;
    return true;
  }

  // ── Helpers ──

  private rowToMessage(row: Record<string, unknown>): SkynetMessage {
    return {
      id: row.id as string,
      type: row.type as SkynetMessage['type'],
      from: row.from as string,
      to: (row.to as string) || null,
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
