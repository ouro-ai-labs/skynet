import type { SkynetMessage, AgentCard, HumanProfile } from '@skynet-ai/protocol';

export interface Store {
  // Messages
  save(msg: SkynetMessage): void;
  getMessages(limit?: number, before?: number, after?: number): SkynetMessage[];
  getById(id: string): SkynetMessage | undefined;
  /** Get recent messages where `mentions` includes `agentId`, optionally after `since` timestamp. */
  getMessagesFor(agentId: string, limit?: number, since?: number): SkynetMessage[];

  // Agents
  saveAgent(agent: AgentCard): void;
  listAgents(): AgentCard[];
  getAgent(idOrName: string): AgentCard | undefined;
  deleteAgent(id: string): boolean;

  // Humans
  saveHuman(human: HumanProfile): void;
  listHumans(): HumanProfile[];
  getHuman(idOrName: string): HumanProfile | undefined;
  deleteHuman(id: string): boolean;

  // Name uniqueness
  checkNameUnique(name: string): boolean;

  close(): void;
}
