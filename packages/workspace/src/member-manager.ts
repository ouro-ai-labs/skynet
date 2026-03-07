import type { WebSocket } from 'ws';
import type { AgentCard, AgentStatus, SkynetMessage } from '@skynet/protocol';
import { serialize } from '@skynet/protocol';

export interface ConnectedMember {
  agent: AgentCard;
  socket: WebSocket;
}

export class MemberManager {
  private members = new Map<string, ConnectedMember>();

  join(agent: AgentCard, socket: WebSocket): void {
    this.members.set(agent.id, { agent, socket });
  }

  leave(agentId: string): void {
    this.members.delete(agentId);
  }

  getMember(agentId: string): ConnectedMember | undefined {
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

  broadcastRaw(raw: string, excludeAgentId?: string): void {
    for (const [id, member] of this.members) {
      if (id !== excludeAgentId && member.socket.readyState === member.socket.OPEN) {
        member.socket.send(raw);
      }
    }
  }

  updateStatus(agentId: string, status: AgentStatus): void {
    const member = this.members.get(agentId);
    if (member) {
      member.agent.status = status;
    }
  }
}
