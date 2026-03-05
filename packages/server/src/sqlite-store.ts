import Database from 'better-sqlite3';
import type { SkynetMessage } from '@skynet/protocol';
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
        created_at INTEGER NOT NULL
      );
    `);
  }

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

  saveRoom(roomId: string): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO rooms (id, created_at) VALUES (?, ?)',
    ).run(roomId, Date.now());
  }

  deleteRoom(roomId: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  }

  listRooms(): PersistedRoom[] {
    const rows = this.db.prepare('SELECT id, created_at FROM rooms ORDER BY created_at').all();
    return (rows as Array<{ id: string; created_at: number }>).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
    }));
  }

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

  close(): void {
    this.db.close();
  }
}
