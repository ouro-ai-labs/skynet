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
    case '/agent':
      return handleAgentCommand(serverUrl, subcommand);
    case '/human':
      return handleHumanCommand(serverUrl, subcommand);
    default:
      return null;
  }
}

async function handleAgentCommand(serverUrl: string, sub: string | undefined): Promise<CommandResult> {
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
      return { lines: ['Failed to connect to workspace.'], error: true };
    }
  }

  return { lines: ['Usage: /agent list'], error: true };
}

async function handleHumanCommand(serverUrl: string, sub: string | undefined): Promise<CommandResult> {
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
      return { lines: ['Failed to connect to workspace.'], error: true };
    }
  }

  return { lines: ['Usage: /human list'], error: true };
}
