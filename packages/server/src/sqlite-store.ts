import Database from 'better-sqlite3';
import type { SkynetMessage, AgentProfile, HumanProfile, RoomMembership, MemberType } from '@skynet/protocol';
import type { Store, PersistedRoom } from './store.js';

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
        room_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        reply_to TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages("from");

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT NOT NULL REFERENCES rooms(id),
        member_id TEXT NOT NULL,
        member_type TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, member_id)
      );
    `);
  }

  // ── Messages ──

  save(msg: SkynetMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, type, "from", "to", room_id, timestamp, payload, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.type,
      msg.from,
      msg.to,
      msg.roomId,
      msg.timestamp,
      JSON.stringify(msg.payload),
      msg.replyTo ?? null,
    );
  }

  getByRoom(roomId: string, limit: number = 100, before?: number): SkynetMessage[] {
    const rows = before
      ? this.db.prepare(`
          SELECT * FROM messages WHERE room_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?
        `).all(roomId, before, limit)
      : this.db.prepare(`
          SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?
        `).all(roomId, limit);

    return (rows as Array<Record<string, unknown>>).reverse().map(this.rowToMessage);
  }

  getById(id: string): SkynetMessage | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMessage(row) : undefined;
  }

  // ── Rooms ──

  saveRoom(room: { id: string; name: string }): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO rooms (id, name, created_at) VALUES (?, ?, ?)',
    ).run(room.id, room.name, Date.now());
  }

  deleteRoom(roomId: string): void {
    this.db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  }

  listRooms(): PersistedRoom[] {
    const rows = this.db.prepare('SELECT id, name, created_at FROM rooms ORDER BY created_at').all();
    return (rows as Array<{ id: string; name: string; created_at: number }>).map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
    }));
  }

  getRoomByName(name: string): PersistedRoom | undefined {
    const row = this.db.prepare('SELECT id, name, created_at FROM rooms WHERE name = ?').get(name) as
      | { id: string; name: string; created_at: number }
      | undefined;
    return row ? { id: row.id, name: row.name, createdAt: row.created_at } : undefined;
  }

  // ── Agents ──

  saveAgent(agent: AgentProfile): void {
    this.db.prepare(
      'INSERT INTO agents (id, name, type, role, persona, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(agent.id, agent.name, agent.type, agent.role ?? null, agent.persona ?? null, agent.createdAt);
  }

  listAgents(): AgentProfile[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at').all();
    return (rows as Array<Record<string, unknown>>).map(this.rowToAgent);
  }

  getAgent(idOrName: string): AgentProfile | undefined {
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

  // ── Room Membership ──

  addRoomMember(roomId: string, memberId: string, memberType: MemberType): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO room_members (room_id, member_id, member_type, joined_at) VALUES (?, ?, ?, ?)',
    ).run(roomId, memberId, memberType, Date.now());
  }

  removeRoomMember(roomId: string, memberId: string): void {
    this.db.prepare('DELETE FROM room_members WHERE room_id = ? AND member_id = ?').run(roomId, memberId);
  }

  getRoomMembers(roomId: string): RoomMembership[] {
    const rows = this.db.prepare(
      'SELECT room_id, member_id, member_type, joined_at FROM room_members WHERE room_id = ? ORDER BY joined_at',
    ).all(roomId);
    return (rows as Array<{ room_id: string; member_id: string; member_type: string; joined_at: number }>).map((r) => ({
      roomId: r.room_id,
      memberId: r.member_id,
      memberType: r.member_type as MemberType,
      joinedAt: r.joined_at,
    }));
  }

  // ── Name Uniqueness ──

  checkNameUnique(name: string): boolean {
    const roomRow = this.db.prepare('SELECT 1 FROM rooms WHERE name = ?').get(name);
    if (roomRow) return false;
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
      roomId: row.room_id as string,
      timestamp: row.timestamp as number,
      payload: JSON.parse(row.payload as string),
      replyTo: (row.reply_to as string) || undefined,
    };
  }

  private rowToAgent(row: Record<string, unknown>): AgentProfile {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as AgentProfile['type'],
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
