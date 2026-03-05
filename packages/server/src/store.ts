import type { SkynetMessage } from '@skynet/protocol';

export interface PersistedRoom {
  id: string;
  createdAt: number;
}

export interface Store {
  save(msg: SkynetMessage): void;
  getByRoom(roomId: string, limit?: number, before?: number): SkynetMessage[];
  getById(id: string): SkynetMessage | undefined;
  saveRoom(roomId: string): void;
  deleteRoom(roomId: string): void;
  listRooms(): PersistedRoom[];
  close(): void;
}
