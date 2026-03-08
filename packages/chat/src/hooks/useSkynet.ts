import { useState, useEffect, useCallback, useRef } from 'react';
import { randomUUID } from 'node:crypto';
import {
  AgentType,
  type AgentCard,
  type SkynetMessage,
  type AgentJoinPayload,
  type AgentLeavePayload,
  MessageType,
} from '@skynet-ai/protocol';
import { SkynetClient, type WorkspaceState } from '@skynet-ai/sdk';

export interface UseSkynetOptions {
  serverUrl: string;
  name: string;
  id?: string;
}

export interface SkynetState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  members: Map<string, AgentCard>;
  messages: SkynetMessage[];
  systemMessages: string[];
  workspaceState: WorkspaceState | null;
  busyAgents: Map<string, number>;
}

export interface UseSkynetReturn {
  state: SkynetState;
  sendChat: (text: string, mentions?: string[]) => void;
  close: () => Promise<void>;
  agentId: string;
}

export function useSkynet(opts: UseSkynetOptions): UseSkynetReturn {
  const agentIdRef = useRef(opts.id ?? randomUUID());
  const clientRef = useRef<SkynetClient | null>(null);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Map<string, AgentCard>>(new Map());
  const [messages, setMessages] = useState<SkynetMessage[]>([]);
  const [systemMessages, setSystemMessages] = useState<string[]>([]);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null);
  const [busyAgents, setBusyAgents] = useState<Map<string, number>>(new Map());

  const addSystemMessage = useCallback((text: string) => {
    setSystemMessages((prev) => [...prev, text]);
  }, []);

  useEffect(() => {
    const client = new SkynetClient({
      serverUrl: opts.serverUrl,
      agent: {
        id: agentIdRef.current,
        name: opts.name,
        type: AgentType.HUMAN,
        capabilities: ['chat', 'review'],
        status: 'idle',
      },
    });
    clientRef.current = client;

    client.connect().then((state) => {
      setWorkspaceState(state);
      setConnected(true);
      setConnecting(false);
      const memberMap = new Map<string, AgentCard>();
      for (const m of state.members) {
        memberMap.set(m.id, m);
      }
      setMembers(memberMap);
      if (state.recentMessages.length > 0) {
        setMessages(state.recentMessages);
      }
    }).catch((err: unknown) => {
      setConnecting(false);
      setError(err instanceof Error ? err.message : String(err));
    });

    client.on('message', (msg: SkynetMessage) => {
      if (msg.type === MessageType.AGENT_JOIN) {
        const p = msg.payload as AgentJoinPayload;
        setMembers((prev) => {
          const next = new Map(prev);
          next.set(p.agent.id, p.agent);
          return next;
        });
      } else if (msg.type === MessageType.AGENT_LEAVE) {
        const p = msg.payload as AgentLeavePayload;
        setMembers((prev) => {
          const next = new Map(prev);
          next.delete(p.agentId);
          return next;
        });
      }
      setMessages((prev) => [...prev, msg]);
    });

    client.on('status-change', (data: { agentId: string; status: string }) => {
      if (data.status === 'busy') {
        setBusyAgents((prev) => {
          const next = new Map(prev);
          next.set(data.agentId, Date.now());
          return next;
        });
      } else {
        setBusyAgents((prev) => {
          if (prev.has(data.agentId)) {
            const next = new Map(prev);
            next.delete(data.agentId);
            return next;
          }
          return prev;
        });
      }
      // Update member status in local state
      setMembers((prev) => {
        const member = prev.get(data.agentId);
        if (member) {
          const next = new Map(prev);
          next.set(data.agentId, { ...member, status: data.status as AgentCard['status'] });
          return next;
        }
        return prev;
      });
    });

    client.on('disconnected', () => {
      setConnected(false);
      addSystemMessage('Disconnected from workspace. Will attempt to reconnect...');
    });

    client.on('reconnecting', (info: { attempt: number; delay: number }) => {
      const delaySec = Math.round(info.delay / 1000);
      addSystemMessage(`Reconnecting (attempt ${info.attempt}, next retry in ${delaySec}s)...`);
    });

    client.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg) {
        addSystemMessage(`Error: ${msg}`);
      }
    });

    return () => {
      client.close().catch(() => {});
    };
  }, [opts.serverUrl, opts.name, addSystemMessage]);

  const sendChat = useCallback((text: string, mentions?: string[]) => {
    clientRef.current?.chat(text, mentions);
  }, []);

  const close = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.close();
    }
  }, []);

  return {
    state: { connected, connecting, error, members, messages, systemMessages, workspaceState, busyAgents },
    sendChat,
    close,
    agentId: agentIdRef.current,
  };
}
