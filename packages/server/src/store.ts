import type { SkynetMessage, AgentCard, HumanProfile, RoomMembership, MemberType } from '@skynet/protocol';

export interface PersistedRoom {
  id: string;
  name: string;
  createdAt: number;
}

export interface Store {
  // Messages
  save(msg: SkynetMessage): void;
  getByRoom(roomId: string, limit?: number, before?: number): SkynetMessage[];
  getById(id: string): SkynetMessage | undefined;

  // Rooms
  saveRoom(room: { id: string; name: string }): void;
  deleteRoom(roomId: string): void;
  listRooms(): PersistedRoom[];
  getRoomByName(name: string): PersistedRoom | undefined;

  // Agents
  saveAgent(agent: AgentCard): void;
  listAgents(): AgentCard[];
  getAgent(idOrName: string): AgentCard | undefined;

  // Humans
  saveHuman(human: HumanProfile): void;
  listHumans(): HumanProfile[];
  getHuman(idOrName: string): HumanProfile | undefined;

  // Room membership
  addRoomMember(roomId: string, memberId: string, memberType: MemberType): void;
  removeRoomMember(roomId: string, memberId: string): void;
  getRoomMembers(roomId: string): RoomMembership[];

  // Name uniqueness
  checkNameUnique(name: string): boolean;

  close(): void;
}
