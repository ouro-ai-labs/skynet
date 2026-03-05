import type { WebSocket } from 'ws';
import type { AgentCard, SkynetMessage } from '@skynet/protocol';
import { serialize } from '@skynet/protocol';

export interface RoomMember {
  agent: AgentCard;
  socket: WebSocket;
}

export class Room {
  readonly id: string;
  private members = new Map<string, RoomMember>();

  constructor(id: string) {
    this.id = id;
  }

  join(agent: AgentCard, socket: WebSocket): void {
    this.members.set(agent.agentId, { agent, socket });
  }

  leave(agentId: string): void {
    this.members.delete(agentId);
  }

  getMember(agentId: string): RoomMember | undefined {
    return this.members.get(agentId);
  }

  getMembers(): AgentCard[] {
    return Array.from(this.members.values()).map((m) => m.agent);
  }

  get size(): number {
    return this.members.size;
  }

  broadcast(msg: SkynetMessage, excludeAgentId?: string): void {
    const raw = serialize(msg);
    for (const [id, member] of this.members) {
      if (id !== excludeAgentId && member.socket.readyState === member.socket.OPEN) {
        member.socket.send(raw);
      }
    }
  }

  sendTo(agentId: string, msg: SkynetMessage): boolean {
    const member = this.members.get(agentId);
    if (member && member.socket.readyState === member.socket.OPEN) {
      member.socket.send(serialize(msg));
      return true;
    }
    return false;
  }

  updateStatus(agentId: string, status: AgentCard['status']): void {
    const member = this.members.get(agentId);
    if (member) {
      member.agent.status = status;
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  getOrCreate(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): Array<{ id: string; memberCount: number }> {
    return Array.from(this.rooms.values()).map((r) => ({
      id: r.id,
      memberCount: r.size,
    }));
  }

  removeIfEmpty(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room && room.size === 0) {
      this.rooms.delete(roomId);
    }
  }
}
