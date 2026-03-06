export interface CommandResult {
  lines: string[];
  error?: boolean;
}

export async function executeCommand(serverUrl: string, input: string): Promise<CommandResult | null> {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 0) return null;

  const category = parts[0];
  const subcommand = parts[1];

  switch (category) {
    case '/room':
      return handleRoomCommand(serverUrl, subcommand, parts.slice(2));
    case '/agent':
      return handleAgentCommand(serverUrl, subcommand, parts.slice(2));
    case '/human':
      return handleHumanCommand(serverUrl, subcommand, parts.slice(2));
    default:
      return null;
  }
}

async function handleRoomCommand(serverUrl: string, sub: string | undefined, args: string[]): Promise<CommandResult> {
  if (!sub || sub === 'list') {
    try {
      const res = await fetch(`${serverUrl}/api/rooms`);
      const rooms = await res.json() as Array<{ id: string; name: string; memberCount: number }>;
      if (rooms.length === 0) return { lines: ['No rooms.'] };
      return {
        lines: [
          `Rooms (${rooms.length}):`,
          ...rooms.map((r) => `  ${r.name} (${r.memberCount} members) [${r.id.slice(0, 8)}]`),
        ],
      };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  if (sub === 'new') {
    const name = args[0];
    if (!name) return { lines: ['Usage: /room new <name>'], error: true };
    try {
      const res = await fetch(`${serverUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 201) {
        const body = await res.json() as { id: string; name: string };
        return { lines: [`Room '${body.name}' created. (${body.id.slice(0, 8)})`] };
      }
      const body = await res.json() as { error?: string };
      return { lines: [body.error ?? 'Failed to create room.'], error: true };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  return { lines: ['Unknown room command. Try: /room list, /room new <name>'], error: true };
}

async function handleAgentCommand(serverUrl: string, sub: string | undefined, args: string[]): Promise<CommandResult> {
  if (!sub || sub === 'list') {
    try {
      const res = await fetch(`${serverUrl}/api/agents`);
      const agents = await res.json() as Array<{ id: string; name: string; type: string; role?: string }>;
      if (agents.length === 0) return { lines: ['No agents.'] };
      return {
        lines: [
          `Agents (${agents.length}):`,
          ...agents.map((a) => `  ${a.name} (${a.type})${a.role ? ` [${a.role}]` : ''} [${a.id.slice(0, 8)}]`),
        ],
      };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  if (sub === 'join' || sub === 'leave') {
    return { lines: [`Usage: /agent <name> ${sub} <room>`, 'Example: /agent claude join dev-room'], error: true };
  }

  // `/agent <name> join|leave <room>`
  const agentIdOrName = sub;
  const action = args[0];
  const roomIdOrName = args[1];

  if (action === 'join' && roomIdOrName) {
    try {
      const res = await fetch(`${serverUrl}/api/agents/${encodeURIComponent(agentIdOrName)}/join/${encodeURIComponent(roomIdOrName)}`, {
        method: 'POST',
      });
      if (res.ok) return { lines: ['Agent joined room.'] };
      const body = await res.json() as { error?: string };
      return { lines: [body.error ?? 'Failed.'], error: true };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  if (action === 'leave' && roomIdOrName) {
    try {
      const res = await fetch(`${serverUrl}/api/agents/${encodeURIComponent(agentIdOrName)}/leave/${encodeURIComponent(roomIdOrName)}`, {
        method: 'POST',
      });
      if (res.ok) return { lines: ['Agent left room.'] };
      const body = await res.json() as { error?: string };
      return { lines: [body.error ?? 'Failed.'], error: true };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  return { lines: ['Usage: /agent list, /agent <name> join <room>, /agent <name> leave <room>'], error: true };
}

async function handleHumanCommand(serverUrl: string, sub: string | undefined, args: string[]): Promise<CommandResult> {
  if (!sub || sub === 'list') {
    try {
      const res = await fetch(`${serverUrl}/api/humans`);
      const humans = await res.json() as Array<{ id: string; name: string }>;
      if (humans.length === 0) return { lines: ['No humans.'] };
      return {
        lines: [
          `Humans (${humans.length}):`,
          ...humans.map((h) => `  ${h.name} [${h.id.slice(0, 8)}]`),
        ],
      };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  if (sub === 'join' || sub === 'leave') {
    return { lines: [`Usage: /human <name> ${sub} <room>`, 'Example: /human alice join dev-room'], error: true };
  }

  // `/human <name> join|leave <room>`
  const humanIdOrName = sub;
  const action = args[0];
  const roomIdOrName = args[1];

  if (action === 'join' && roomIdOrName) {
    try {
      const res = await fetch(`${serverUrl}/api/humans/${encodeURIComponent(humanIdOrName)}/join/${encodeURIComponent(roomIdOrName)}`, {
        method: 'POST',
      });
      if (res.ok) return { lines: ['Human joined room.'] };
      const body = await res.json() as { error?: string };
      return { lines: [body.error ?? 'Failed.'], error: true };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  if (action === 'leave' && roomIdOrName) {
    try {
      const res = await fetch(`${serverUrl}/api/humans/${encodeURIComponent(humanIdOrName)}/leave/${encodeURIComponent(roomIdOrName)}`, {
        method: 'POST',
      });
      if (res.ok) return { lines: ['Human left room.'] };
      const body = await res.json() as { error?: string };
      return { lines: [body.error ?? 'Failed.'], error: true };
    } catch {
      return { lines: ['Failed to connect to server.'], error: true };
    }
  }

  return { lines: ['Usage: /human list, /human <name> join <room>, /human <name> leave <room>'], error: true };
}
