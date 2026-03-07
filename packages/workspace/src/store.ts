import type { SkynetMessage, AgentCard, HumanProfile } from '@skynet/protocol';

export interface Store {
  // Messages
  save(msg: SkynetMessage): void;
  getMessages(limit?: number, before?: number): SkynetMessage[];
  getById(id: string): SkynetMessage | undefined;

  // Agents
  saveAgent(agent: AgentCard): void;
  listAgents(): AgentCard[];
  getAgent(idOrName: string): AgentCard | undefined;

  // Humans
  saveHuman(human: HumanProfile): void;
  listHumans(): HumanProfile[];
  getHuman(idOrName: string): HumanProfile | undefined;

  // Name uniqueness
  checkNameUnique(name: string): boolean;

  close(): void;
}
